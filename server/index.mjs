/**
 * OpenHorizon companion server (§3, real since 15b): mounts the SAME
 * route() the Vite dev middleware uses — terrain/landcover/imagery/
 * NEXRAD proxies, airports/navaids/airspace/procedures/frequencies/
 * aircraft-types/METAR/traffic APIs — and serves the built client from
 * ../dist when present, so `npm run build && node server/index.mjs` is
 * a self-contained sim host. The Phase-0 stub answered 501 to
 * everything; the duplicate frequencies branch died in 12a.
 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { route } from './handlers.mjs'

const PORT = process.env.PORT ?? 8787
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const app = express()

app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  next()
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'openhorizon-server', dist: fs.existsSync(distDir) })
})

// Data endpoints — identical behavior to the dev middleware.
app.use((req, res, next) => {
  route(req.url ?? '', res)
    .then((handled) => {
      if (!handled) next()
    })
    .catch(next)
})

// Built client (when `npm run build` has run) + SPA fallback.
if (fs.existsSync(distDir)) {
  // index.html must revalidate on every load or the browser keeps serving
  // WEEKS-old builds on plain reloads (the user kept seeing long-fixed
  // bugs — flaps, winglets, lights — because their pane never fetched the
  // new bundle). Hashed assets are immutable and can cache forever.
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate')
      else if (/assets[\/\\]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    },
  }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.includes('.')) return next()
    res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`[openhorizon-server] listening on http://localhost:${PORT}${fs.existsSync(distDir) ? ' (serving dist/)' : ' (API only — run npm run build for the client)'}`)
})
