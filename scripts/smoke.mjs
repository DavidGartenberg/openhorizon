#!/usr/bin/env node
/**
 * Browser smoke test: boots the sim headless and fails on uncaught page
 * errors or a black / blank 3D view — the class of regression unit tests
 * cannot see (e.g. the aircraft spawning under the ground when the airport
 * list failed to load turned the whole screen black).
 *
 * Scenarios:
 *   1. normal boot
 *   2. airport data unavailable (the request is failed by the browser): the
 *      sim must still render and park the aircraft ("NO AIRPORT DATA").
 *
 * Usage:
 *   npm run smoke                      # starts its own Vite dev server
 *   npm run smoke -- --url http://localhost:5173
 *
 * Needs Playwright with Chromium (`npm i -D playwright && npx playwright
 * install chromium`). Software rendering is slow, so allow a minute or two.
 */
import { createRequire } from 'node:module'
import net from 'node:net'
import zlib from 'node:zlib'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('smoke: Playwright is required — npm i -D playwright && npx playwright install chromium')
  process.exit(2)
}

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const BOOT_MS = Number(arg('--boot-ms') ?? 90_000)
/** After the spawn shows on the HUD, let a few frames render (software GL is slow). */
const SETTLE_MS = Number(arg('--settle-ms') ?? 20_000)
/** Optional directory to save each scenario's screenshot (debugging). */
const SHOTS = arg('--shots')

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

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) → { w, h, ch, px }. */
function decodePng(buf) {
  let off = 8, w = 0, h = 0, ch = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('smoke: unsupported PNG')
      ch = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0
      if (!ch) throw new Error('smoke: unsupported PNG colour type')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const px = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0
      const b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0
      let v = src[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      px[y * stride + x] = v & 255
    }
  }
  return { w, h, ch, px }
}

/** Mean and spread of luminance over the middle of the view (HUD excluded). */
function viewStats(png) {
  const { w, h, ch, px } = png
  let n = 0, sum = 0, sum2 = 0
  for (let y = Math.floor(h * 0.3); y < h * 0.85; y += 3) {
    for (let x = Math.floor(w * 0.1); x < w * 0.9; x += 3) {
      const i = (y * w + x) * ch
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
      sum += l; sum2 += l * l; n++
    }
  }
  const mean = sum / n
  return { mean, std: Math.sqrt(Math.max(sum2 / n - mean * mean, 0)) }
}

async function scenario(browser, url, name, setup, readyText) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  if (setup) await setup(page)
  await page.goto(url, { waitUntil: 'load' })
  // Wait for the spawn to show on the HUD, then for frames to render after it.
  const ready = await page.waitForFunction((t) => (document.getElementById('hud')?.textContent ?? '').includes(t), readyText, { timeout: BOOT_MS, polling: 1000 }).then(() => true, () => false)
  if (!ready) errors.push(`HUD never showed "${readyText}" within ${BOOT_MS / 1000} s`)
  await page.waitForTimeout(SETTLE_MS)
  const hud = await page.evaluate(() => document.getElementById('hud')?.textContent ?? '')
  const shot = await page.screenshot({ type: 'png' })
  if (SHOTS) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(SHOTS, { recursive: true })
    writeFileSync(`${SHOTS}/${name.replace(/[^a-z0-9]+/gi, '-')}.png`, shot)
  }
  const stats = viewStats(decodePng(shot))
  await page.close()
  const problems = [...errors]
  if (stats.mean < 12) problems.push(`3D view is black (mean luminance ${stats.mean.toFixed(1)})`)
  if (stats.std < 1.5) problems.push(`3D view is blank (luminance spread ${stats.std.toFixed(2)})`)
  if (!hud.includes('OpenHorizon')) problems.push('HUD did not render')
  console.log(`${problems.length ? '✗' : '✓'} ${name} — view mean ${stats.mean.toFixed(0)}, spread ${stats.std.toFixed(1)}`)
  for (const p of problems) console.log(`    ${p}`)
  return { name, problems, hud }
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
let failed = false
try {
  const a = await scenario(browser, url, 'normal boot', null, 'KHAF')
  const b = await scenario(browser, url, 'airport data unavailable', (page) => page.route('**/api/airports.json', (r) => r.fulfill({ status: 503, body: 'unavailable' })), 'NO AIRPORT DATA')
  failed = a.problems.length > 0 || b.problems.length > 0
} finally {
  await browser.close()
  await server?.close()
}
console.log(failed ? 'smoke: FAILED' : 'smoke: passed')
process.exit(failed ? 1 : 0)
