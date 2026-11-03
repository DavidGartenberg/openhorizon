/**
 * The HUD stall warning needs airflow over the wing: a parked airplane in a
 * gusty breeze showed "⚠ STALL" (gusts at a 2-kt airspeed read as a huge
 * angle of attack). Gate: airborne and above 20 KIAS.
 */
import { describe, expect, it } from 'vitest'
import { stallWarningActive } from '../src/ui/hud'

describe('HUD stall warning gate', () => {
  it('is silent on the ground whatever the vane reads', () => {
    expect(stallWarningActive({ stallFraction: 0.9, onGround: true, kias: 4 })).toBe(false)
    expect(stallWarningActive({ stallFraction: 0.9, onGround: true, kias: 45 })).toBe(false)
  })
  it('is silent at a crawl even if the weight-on-wheels switch is open (bounce)', () => {
    expect(stallWarningActive({ stallFraction: 0.9, onGround: false, kias: 12 })).toBe(false)
  })
  it('warns in flight near the stall and not below the threshold', () => {
    expect(stallWarningActive({ stallFraction: 0.5, onGround: false, kias: 50 })).toBe(true)
    expect(stallWarningActive({ stallFraction: 0.2, onGround: false, kias: 50 })).toBe(false)
  })
})
