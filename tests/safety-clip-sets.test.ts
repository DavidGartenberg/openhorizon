import {readFileSync,existsSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
import {STATIC_SAFETY_PHRASES} from '../src/audio/browser-speech'

describe.each(['safety','safety-boeing'])('public/audio/%s clip set', folder => {
  const manifest = JSON.parse(readFileSync(`public/audio/${folder}/manifest.json`,'utf8')) as Record<string,string>
  it('covers every static safety phrase with a valid mono 16 kHz PCM16 WAV', () => {
    for (const phrase of STATIC_SAFETY_PHRASES) {
      const url = manifest[phrase]
      expect(url, phrase).toMatch(new RegExp(`^/audio/${folder}/[a-z0-9-]+\\.wav$`))
      const path = `public${url}`
      expect(existsSync(path), path).toBe(true)
      const b = readFileSync(path)
      expect(b.toString('ascii',0,4)).toBe('RIFF')
      let at = 12, fmt = -1
      while (at + 8 <= b.length) { const n = b.readUInt32LE(at + 4); if (b.toString('ascii', at, at + 4) === 'fmt ') { fmt = at + 8; break } at += 8 + n + (n % 2) }
      expect(fmt, path).toBeGreaterThan(0)
      expect(b.readUInt16LE(fmt)).toBe(1)
      expect(b.readUInt16LE(fmt + 2)).toBe(1)
      expect(b.readUInt32LE(fmt + 4)).toBe(16000)
      expect(b.readUInt16LE(fmt + 14)).toBe(16)
      expect(b.length).toBeGreaterThan(8000)
    }
  })
})
