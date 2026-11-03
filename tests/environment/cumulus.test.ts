import { describe, expect, it } from 'vitest'
import { thermalCumulus, condensationLevelM } from '../../src/sim/environment/cumulus'
import { ThermalField, boundaryLayerDepthM } from '../../src/sim/environment/thermals'

describe('fair-weather cumulus over thermals', () => {
  const field = new ThermalField(7)
  it('puts the base at the lifting condensation level (~125 m per °C of spread)', () => {
    expect(condensationLevelM(8)).toBe(1000)
    const cu = thermalCumulus(field, 0, 0, 600, 0.9, 6)
    expect(cu.length).toBeGreaterThan(3)
    for (const c of cu) {
      expect(c.baseAglM).toBe(750)
      expect(c.thicknessM).toBeGreaterThan(200) // young clouds are shallower
    }
    // Mature clouds reach about the inversion.
    expect(Math.max(...cu.map((c) => c.baseAglM + c.thicknessM))).toBeGreaterThan(boundaryLayerDepthM(0.9) * 0.9)
  })

  it('keeps the thermals blue when the air is too dry to condense below the inversion', () => {
    expect(thermalCumulus(field, 0, 0, 600, 0.9, 25)).toEqual([])
    expect(thermalCumulus(field, 0, 0, 600, 0.1, 4)).toEqual([]) // too weak a day
  })

  it('sits over living thermals and drifts downwind with the rising air', () => {
    const calm = thermalCumulus(field, 0, 0, 600, 0.9, 6)
    const windy = thermalCumulus(field, 0, 0, 600, 0.9, 6, 0, 8)
    expect(windy.length).toBeGreaterThan(0)
    const meanE = (list: typeof calm) => list.reduce((s, c) => s + c.e, 0) / list.length
    expect(meanE(windy)).toBeGreaterThan(meanE(calm))
  })
})
