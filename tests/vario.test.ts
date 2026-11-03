import { describe, expect, it } from 'vitest'
import { TeVario, varioTone } from '../src/sim/vario'

describe('total-energy variometer', () => {
  it('reads steady climb, ignoring speed traded for height', () => {
    const v = new TeVario()
    // Pull-up in still air: 2 m/s of climb paid for by slowing down.
    let h = 1000, V = 30
    for (let t = 0; t < 10; t += 0.05) {
      h += 2 * 0.05
      V = Math.sqrt(Math.max(30 * 30 - 2 * 9.80665 * (h - 1000), 1))
      v.step(0.05, h, V)
    }
    expect(Math.abs(v.rateMs)).toBeLessThan(0.05)
    // Real lift: climb at constant speed.
    const w = new TeVario()
    for (let t = 0, hh = 1000; t < 10; t += 0.05) { hh += 2.5 * 0.05; w.step(0.05, hh, 30) }
    expect(w.rateMs).toBeGreaterThan(2.4)
  })

  it('beeps faster and higher with more lift, hums in strong sink, is quiet between', () => {
    const weak = varioTone(0.6), strong = varioTone(3)
    expect(weak.on && strong.on).toBe(true)
    expect(strong.freqHz).toBeGreaterThan(weak.freqHz)
    expect(strong.beepHz).toBeGreaterThan(weak.beepHz)
    expect(varioTone(-0.8).on).toBe(false)
    const sink = varioTone(-3)
    expect(sink.on).toBe(true)
    expect(sink.beepHz).toBe(0)
    expect(sink.freqHz).toBeLessThan(weak.freqHz)
  })
})
