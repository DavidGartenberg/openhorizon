/**
 * Read-only static route for the user's LOCAL X-Plane 12 install, so the
 * client can load Laminar aircraft geometry/textures (.obj/.png/.dds/.txt)
 * straight from disk. Nothing is copied into the repo. When X-Plane is
 * not installed the file route answers 404 {error:'xplane-not-found'} and
 * the manifest reports available:false, so the client keeps its fallbacks.
 *
 *   GET /xp/manifest.json         → {available: boolean, base: string}
 *   GET /xp/aircraft/<rel path>   → streams the file (see resolveXpPath)
 *
 * Override the location with XPLANE_DIR — the "Laminar Research" aircraft
 * folder, not the X-Plane root.
 */
import fs from 'node:fs'
import path from 'node:path'

export const XPLANE_DIR_DEFAULT = '/Users/davidgartenberg/X-Plane 12/Aircraft/Laminar Research'
export const XPLANE_DIR = process.env.XPLANE_DIR || XPLANE_DIR_DEFAULT

const CONTENT_TYPES = {
  '.obj': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.dds': 'application/octet-stream',
}

/** Content-Type for an allow-listed X-Plane asset extension, else null. */
export function xpContentType(ext) {
  return CONTENT_TYPES[String(ext).toLowerCase()] ?? null
}

/**
 * Path-safety helper (unit-tested): map the URL path after /xp/aircraft/
 * to an absolute file under `base`, or return null when the request must
 * be refused. Refuses malformed percent-encoding, NUL bytes, backslashes,
 * absolute paths, empty/`.`/`..` segments, anything whose resolved path
 * leaves `base`, and any extension outside the .obj/.png/.dds/.txt list.
 * Returns { abs, contentType } on success.
 */
export function resolveXpPath(relUrlPath, base = XPLANE_DIR) {
  if (typeof relUrlPath !== 'string' || relUrlPath.length === 0) return null
  let rel
  try {
    rel = decodeURIComponent(relUrlPath)
  } catch {
    return null
  }
  if (rel.includes('\0') || rel.includes('\\')) return null
  if (rel.startsWith('/') || path.isAbsolute(rel)) return null
  const segments = rel.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  const contentType = xpContentType(path.extname(rel))
  if (!contentType) return null
  const root = path.resolve(base)
  const abs = path.resolve(root, rel)
  // Prefix check with a trailing separator so "…/Laminar Research-evil"
  // cannot pass as a child of "…/Laminar Research".
  if (!abs.startsWith(root + path.sep)) return null
  return { abs, contentType }
}

function baseAvailable(base) {
  try {
    return fs.statSync(base).isDirectory()
  } catch {
    return false
  }
}

/** GET /xp/manifest.json payload. */
export function xpManifest(base = XPLANE_DIR) {
  return { available: baseAvailable(base), base }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(body))
  return true
}

/**
 * Handle /xp/* URLs. Resolves true when a response was sent, false when
 * the URL is not an X-Plane route (caller falls through to next()).
 */
export async function xpRoute(url, res, base = XPLANE_DIR) {
  if (!url.startsWith('/xp/')) return false
  const pathname = url.split('?')[0]
  if (pathname === '/xp/manifest.json') return sendJson(res, 200, xpManifest(base))
  const prefix = '/xp/aircraft/'
  if (!pathname.startsWith(prefix)) return false
  if (!baseAvailable(base)) return sendJson(res, 404, { error: 'xplane-not-found' })
  const resolved = resolveXpPath(pathname.slice(prefix.length), base)
  if (!resolved) return sendJson(res, 403, { error: 'forbidden' })
  let real
  let stat
  try {
    // A symlink inside the install must not lead outside it either, so
    // compare real paths, not just the lexical ones the helper checked.
    real = await fs.promises.realpath(resolved.abs)
    const realRoot = await fs.promises.realpath(base)
    if (!real.startsWith(realRoot + path.sep)) return sendJson(res, 403, { error: 'forbidden' })
    stat = await fs.promises.stat(real)
  } catch {
    return sendJson(res, 404, { error: 'not-found' })
  }
  if (!stat.isFile()) return sendJson(res, 404, { error: 'not-found' })
  res.writeHead(200, {
    'Content-Type': resolved.contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  })
  const stream = fs.createReadStream(real)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
  return true
}
