/** Minimal 2D-canvas stand-in for node tests: every drawing call is a
 *  recorded no-op; measureText gives a plausible width. */
export interface RecordingCtx { calls: Array<{ fn: string; args: unknown[] }>; fills: string[]; texts: Array<{ text: string; color: string }> }

export function makeRecordingCtx(): CanvasRenderingContext2D & RecordingCtx {
  const rec: RecordingCtx = { calls: [], fills: [], texts: [] }
  let fillStyle: unknown = '#000'
  const target: Record<string, unknown> = {
    ...rec,
    canvas: { width: 1024, height: 1024 },
    measureText: (t: string) => ({ width: t.length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillText: (text: string) => { rec.texts.push({ text, color: String(fillStyle) }) },
  }
  return new Proxy(target, {
    get(t, k: string) {
      if (k === 'fillStyle') return fillStyle
      if (k in t) return t[k]
      return (...args: unknown[]) => { rec.calls.push({ fn: k, args }) }
    },
    set(t, k: string, v) {
      if (k === 'fillStyle') { fillStyle = v; rec.fills.push(String(v)) } else t[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D & RecordingCtx
}

/** Install a fake `document.createElement('canvas')` for the test file. */
export function installCanvasStub(): void {
  const g = globalThis as unknown as { document?: unknown }
  if (g.document) return
  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`stub: ${tag}`)
      const ctx = makeRecordingCtx()
      const canvas = { width: 300, height: 150, getContext: () => ctx }
      ;(ctx as unknown as { canvas: unknown }).canvas = canvas
      return canvas
    },
  }
}
