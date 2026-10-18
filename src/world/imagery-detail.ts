import * as THREE from 'three'

interface ImageryChild {
  z: number
  x: number
  y: number
  px: number
  py: number
}

/** Exact north-first child tile footprint, in 256-pixel canvas cells. */
export function imageryChildren(z: number, x: number, y: number, targetZoom: number): ImageryChild[] {
  const delta = targetZoom - z
  if (!Number.isInteger(delta) || delta < 0 || delta > 3) {
    throw new RangeError('Imagery refinement must be an integer between zero and three zoom levels')
  }
  if (![z, x, y, targetZoom].every(Number.isInteger) || z < 0 || targetZoom > 30 ||
      x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    throw new RangeError('Invalid imagery tile coordinates')
  }
  const across = 2 ** delta
  const children: ImageryChild[] = []
  for (let row = 0; row < across; row++) {
    for (let col = 0; col < across; col++) {
      children.push({ z: targetZoom, x: x * across + col, y: y * across + row, px: col * 256, py: row * 256 })
    }
  }
  return children
}

/** Compose one z13 footprint from its 64 z16 photographs. At most four
 * requests/decodes run concurrently. The caller owns the returned texture;
 * on failure we abort requests, drain decodes and release every bitmap. */
export async function loadDetailedImagery(key: string, signal: AbortSignal): Promise<THREE.CanvasTexture> {
  signal.throwIfAborted()
  if (!/^13\/\d+\/\d+$/.test(key)) throw new RangeError('Detailed imagery requires a z13 tile key')
  const [z, x, y] = key.split('/').map(Number)
  const children = imageryChildren(z!, x!, y!, 16)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2048
  const controller = new AbortController()
  const abort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  // Handle an abort arriving between the initial check and registration.
  if (signal.aborted) abort()
  let delivered = false
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable for detailed imagery')
    let cursor = 0
    let firstError: unknown
    let failed = false
    const worker = async (): Promise<void> => {
      try {
        while (cursor < children.length) {
          controller.signal.throwIfAborted()
          const child = children[cursor++]!
          const res = await fetch(`/proxy/imagery/${child.z}/${child.x}/${child.y}`, { signal: controller.signal })
          if (!res.ok) throw new Error(`Detailed imagery ${child.z}/${child.x}/${child.y}: HTTP ${res.status}`)
          const blob = await res.blob()
          controller.signal.throwIfAborted()
          // ImageBitmap decoding is not abortable; allSettled below waits for
          // it and the finally closes it even when another worker has failed.
          const bitmap = await createImageBitmap(blob)
          try {
            controller.signal.throwIfAborted()
            ctx.drawImage(bitmap, child.px, child.py, 256, 256)
          } finally {
            bitmap.close()
          }
        }
      } catch (error) {
        if (!failed) { firstError = error; failed = true }
        controller.abort(error)
        throw error
      }
    }
    await Promise.allSettled(Array.from({ length: 4 }, () => worker()))
    if (failed) throw firstError
    controller.signal.throwIfAborted()
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    delivered = true
    return texture
  } finally {
    signal.removeEventListener('abort', abort)
    if (!delivered) {
      controller.abort()
      // Drop backing storage after all active workers/decoders have drained.
      canvas.width = canvas.height = 0
    }
  }
}
