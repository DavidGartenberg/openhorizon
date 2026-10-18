import { describe, expect, it } from 'vitest'
import { CUSTOM_PACK_BASE, loadCustomPack, parseCustomPack, safePackFile } from '../src/audio/custom-audio-pack'

describe('user-supplied licensed audio pack', () => {
  it('accepts only plain audio file names inside the pack folder', () => {
    expect(safePackFile('fire-bell.wav')).toBe('fire-bell.wav')
    expect(safePackFile('Gear Horn 01.mp3')).toBe('Gear Horn 01.mp3')
    for (const bad of ['../secret.wav', '/etc/passwd.wav', 'https://x.test/a.wav', 'sub/dir.wav', 'evil.js', '..wav', '', 42, null]) expect(safePackFile(bad), String(bad)).toBeUndefined()
  })
  it('keeps known aurals and phrases, drops everything else', () => {
    const p = parseCustomPack({
      aurals: { fireBell: 'bell.wav', apWailer: '../x.wav', bogus: 'b.wav', altAlert: 'alt.ogg' },
      voice: { 'PULL UP': 'pull.wav', 'SAY HELLO': 'hi.wav', 'SINK RATE': 'http://evil/sink.wav' },
    })
    expect(p.aurals).toEqual({ fireBell: CUSTOM_PACK_BASE + 'bell.wav', altAlert: CUSTOM_PACK_BASE + 'alt.ogg' })
    expect(p.voice).toEqual({ 'PULL UP': CUSTOM_PACK_BASE + 'pull.wav' })
    expect(parseCustomPack('nope')).toEqual({ aurals: {}, voice: {} })
  })
  it('treats a missing pack (404 or dev-server HTML fallback) as empty', async () => {
    const html = (async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    expect(await loadCustomPack(html)).toEqual({ aurals: {}, voice: {} })
    const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    expect(await loadCustomPack(missing)).toEqual({ aurals: {}, voice: {} })
    const ok = (async () => new Response(JSON.stringify({ aurals: { clacker: 'c.wav' } }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    expect((await loadCustomPack(ok)).aurals.clacker).toBe(CUSTOM_PACK_BASE + 'c.wav')
  })
})
