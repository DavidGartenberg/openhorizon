/**
 * Cosmetic traffic attitude (14d) — ADS-B carries no attitude, so the
 * render layer derives a LABELED-COSMETIC one: pitch from vs/gs
 * (clamped ±12°), coordinated-turn roll from the observed track rate
 * (clamped ±25°).
 */
import { describe, expect, it } from 'vitest'
import { cosmeticAttitude } from '../../src/render/traffic-layer'

const DEG = Math.PI / 180

describe('cosmeticAttitude', () => {
  it('level cruise reads level', () => {
    const a = cosmeticAttitude(250, 0, 0)
    expect(a.pitchRad).toBeCloseTo(0, 6)
    expect(a.rollRad).toBeCloseTo(0, 6)
  })
  it('a 700 fpm climb at 90 kt pitches up a few degrees', () => {
    const a = cosmeticAttitude(90, 700, 0)
    expect(a.pitchRad).toBeGreaterThan(2 * DEG)
    expect(a.pitchRad).toBeLessThan(8 * DEG)
  })
  it('pitch clamps at ±12° even for absurd vs/gs ratios', () => {
    expect(cosmeticAttitude(60, 6000, 0).pitchRad).toBeCloseTo(12 * DEG, 3)
    expect(cosmeticAttitude(60, -6000, 0).pitchRad).toBeCloseTo(-12 * DEG, 3)
  })
  it('a standard-rate turn at 120 kt rolls ~17°, clamped at 25°', () => {
    const std = cosmeticAttitude(120, 0, 3)
    expect(std.rollRad).toBeGreaterThan(14 * DEG)
    expect(std.rollRad).toBeLessThan(20 * DEG)
    expect(cosmeticAttitude(400, 0, 10).rollRad).toBeCloseTo(25 * DEG, 3)
  })
})
