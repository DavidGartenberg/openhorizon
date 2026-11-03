/**
 * Frame-time benchmark: boots the sim headless at a fixed scene and measures
 * GPU-synchronised frame times with `__ohBench` (each frame is followed by a
 * 1-pixel readback, so the time includes the GPU's work, not just the
 * JavaScript that queued it). It then hides one scene category at a time to
 * attribute the cost, so optimisations are made against measurements.
 *
 * Under software GL (SwiftShader, as in CI or a sandbox) the absolute numbers
 * are seconds per frame, far from a real GPU's. But the work is the same
 * work, so relative changes, and which category dominates, carry over.
 *
 * Usage:
 *   npm run bench                              # starts its own Vite dev server
 *   npm run bench -- --url http://localhost:5173 --frames 4 --size 960x540
 *   npm run bench -- --json out.json           # also write the results
 *   npm run bench -- --cats terrain,terrain:z11,shadows   # attribute only these
 *   npm run bench -- --ab nocull               # same-scene A/B: coverage culling off
 */
import { createRequire } from 'node:module'
import net from 'node:net'
import { writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('bench: Playwright is required — npm i -D playwright && npx playwright install chromium')
  process.exit(2)
}

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const FRAMES = Number(arg('--frames') ?? 4)
const WARMUP = Number(arg('--warmup') ?? 2)
const [W, H] = (arg('--size') ?? '960x540').split('x').map(Number)
const ATTRIBUTE = !process.argv.includes('--no-attribute')
const JSON_OUT = arg('--json')
// Fixed, reproducible weather: scattered cumulus (cloud volumes in view).
const METAR = arg('--metar') ?? 'KHAF 031800Z 27008KT 10SM SCT035 BKN080 16/09 A3002'

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

let server
let url = arg('--url')
if (!url) {
  const { createServer } = await import('vite')
  const port = await freePort()
  server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' })
  await server.listen()
  url = `http://localhost:${port}/`
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const results = { url, size: [W, H], frames: FRAMES, metar: METAR, runs: [] }
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`))
  // Shader compile/link failures are console errors, not exceptions.
  page.on('console', (m) => { if (m.type() === 'error' && /shader|program|webgl/i.test(m.text())) console.log(`console error: ${m.text().slice(0, 600)}`) })
  // Fixed frame-rate mode: dynamic resolution would otherwise shrink the
  // canvas under slow software GL and move the target mid-measurement.
  await page.addInitScript(() => { try { localStorage.setItem('oh-frame-rate', '0') } catch { /* */ } })
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => (document.getElementById('hud')?.textContent ?? '').includes('KHAF'), null, { timeout: 150_000, polling: 1000 })
  await page.evaluate((m) => { window.__ohSetWx?.(m); window.__ohRate?.(0) }, METAR)
  // Let tiles stream in: wait until the tile set is stable and idle, so
  // every run below measures the same scene.
  const t0 = Date.now()
  let last = '', stable = 0
  while (Date.now() - t0 < Number(arg('--settle-ms') ?? 180_000)) {
    await page.waitForTimeout(5000)
    const t = await page.evaluate(() => window.__ohTiles?.() ?? {})
    const key = `${t.tiles}/${t.ready}/${t.queued}/${t.loading}`
    stable = key === last && !t.queued ? stable + 1 : 0
    last = key
    if (stable >= 3) break
  }
  console.log(`scene settled after ${((Date.now() - t0) / 1000).toFixed(0)} s (tiles ${last})`)
  const run = async (hide) => {
    const r = await page.evaluate(([f, w, h]) => window.__ohBench(f, w, h), [FRAMES, WARMUP, hide])
    results.runs.push(r)
    return r
  }
  const all = await run([])
  console.log(`all            ${String(all.frameMs).padStart(8)} ms/frame  (cpu ${all.cpuMs} ms, ${all.calls} draws, ${(all.triangles / 1000).toFixed(0)}k tris, ${all.size.join('×')})`)
  const terr = all.children.filter((c) => c.cat === 'terrain')
  console.log(`   terrain: ${terr.length} tiles, ${(terr.reduce((a, c) => a + c.tris, 0) / 1000).toFixed(0)}k tris`)
  for (const c of all.children.filter((c) => c.cat !== 'terrain')) console.log(`   #${String(c.i).padEnd(3)} ${c.cat.padEnd(16)} ${String(c.drawables).padStart(4)} drawables ${String((c.tris / 1000).toFixed(0)).padStart(5)}k tris  ${c.mat}`)
  // --ab nocull: alternate the named variant with the default N times in the
  // same scene (drift-proof A/B), and report both means.
  const AB = arg('--ab')
  if (AB) {
    const n = Number(arg('--ab-rounds') ?? 4)
    const a = [], b = []
    for (let i = 0; i < n; i++) {
      const base = await run([]); const alt = await run([AB])
      a.push(base.frameMs); b.push(alt.frameMs)
      console.log(`  round ${i + 1}: default ${base.frameMs} ms (${base.calls} draws, ${(base.triangles / 1000).toFixed(0)}k tris) · ${AB} ${alt.frameMs} ms (${alt.calls} draws, ${(alt.triangles / 1000).toFixed(0)}k tris)`)
    }
    const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length
    const ma = mean(a), mb = mean(b)
    console.log(`A/B: default ${ma.toFixed(0)} ms vs ${AB} ${mb.toFixed(0)} ms → default is ${(100 * (mb - ma) / mb).toFixed(1)}% faster (${(mb / ma).toFixed(2)}× fps)`)
    results.ab = { variant: AB, defaultMs: a, variantMs: b }
  }
  if (ATTRIBUTE && !AB) {
    // Each category against a fresh baseline right before it (drift-proof).
    // Terrain tiles as one category; everything else per scene object.
    const big = arg('--cats')?.split(',') ?? ['terrain', ...all.children.filter((c) => c.cat !== 'terrain').map((c) => `#${c.i}`)]
    for (const c of arg('--cats') ? big : ['shadows', ...big]) {
      const base = await run([])
      const r = await run([c])
      const saved = base.frameMs - r.frameMs
      const label = c.startsWith('#') ? `${c} ${all.children.find((x) => `#${x.i}` === c)?.cat}` : c
      console.log(`− ${label.padEnd(20)}${String(r.frameMs).padStart(8)} vs ${String(base.frameMs).padStart(8)} ms → costs ${saved.toFixed(0).padStart(6)} ms (${((100 * saved) / base.frameMs).toFixed(0)}%)`)
    }
  }
} finally {
  await browser.close()
  await server?.close()
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 2))
