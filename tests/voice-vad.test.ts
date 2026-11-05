import { describe, expect, it } from 'vitest'
import { makeVad, vadStep } from '../src/voice/recorder'

const run = (levels: Array<[number, number]>) => {
  const s = makeVad(); let firedAt = -1; let t = 0
  for (const [rms, secs] of levels) {
    for (let i = 0; i < secs * 10; i++) { t += 0.1; if (vadStep(s, rms, 0.1) && firedAt < 0) firedAt = t }
  }
  return { firedAt, s }
}

describe('end-of-speech detection', () => {
  it('fires about a second after the pilot stops talking', () => {
    const r = run([[0.004, 0.5], [0.08, 2.0], [0.004, 3]])
    expect(r.firedAt).toBeGreaterThan(2.5 + 1.0)
    expect(r.firedAt).toBeLessThan(2.5 + 1.4)
  })
  it('does not fire during a short pause inside a transmission', () => {
    const r = run([[0.003, 0.3], [0.07, 1.0], [0.003, 0.6], [0.07, 1.0], [0.003, 0.5]])
    expect(r.firedAt).toBe(-1)
  })
  it('does not fire on a quiet room before anyone speaks, until it gives up', () => {
    expect(run([[0.003, 7]]).firedAt).toBe(-1)
    expect(run([[0.003, 9]]).firedAt).toBeGreaterThan(7.9)
  })
  it('works in a noisy room: background chatter below speech level is learned, speech still ends the turn', () => {
    const r = run([[0.011, 3], [0.12, 1.5], [0.011, 3]])
    expect(r.firedAt).toBeGreaterThan(3 + 1.5)
    expect(r.firedAt).toBeLessThan(3 + 1.5 + 1.6)
  })
  it('fires once only', () => {
    const s = makeVad(); let n = 0
    for (let i = 0; i < 200; i++) if (vadStep(s, i < 20 ? 0.1 : 0.003, 0.1)) n++
    expect(n).toBe(1)
  })
})
