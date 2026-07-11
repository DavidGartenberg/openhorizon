/**
 * OpenHorizon companion server (§3): CORS proxy + disk cache for terrain
 * tiles, weather, and nav data. Phase 0 ships the skeleton only — routes are
 * honestly INOP until Phase 2 needs them.
 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT ?? 8787
const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache')
fs.mkdirSync(cacheDir, { recursive: true })

const app = express()

app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  next()
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'openhorizon-server', phase: 0 })
})

app.get('/proxy/*', (_req, res) => {
  res.status(501).json({
    error: 'INOP — proxy routes arrive with Phase 2 (terrain tile streaming)',
  })
})

app.listen(PORT, () => {
  console.log(`[openhorizon-server] listening on http://localhost:${PORT}`)
})
