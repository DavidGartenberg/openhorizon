import { describe, expect, it } from 'vitest'
import { convectiveTurbulence, rotorTurbulence, effectiveTurbulence } from '../src/sim/weather/turbulence-sources'

describe('turbulence sources', () => {
  it('storms: severe in heavy +TS, moderate in TS, less in the vicinity, growing near heavy cells', () => {
    expect(convectiveTurbulence([], null)).toBe(0)
    expect(convectiveTurbulence(['+TSRA'], null)).toBe(3)
    expect(convectiveTurbulence(['TSRA'], null)).toBeGreaterThanOrEqual(2)
    expect(convectiveTurbulence(['VCTS'], null)).toBeLessThan(convectiveTurbulence(['TSRA'], null))
    expect(convectiveTurbulence([], 1500)).toBe(3)
    expect(convectiveTurbulence([], 8000)).toBeLessThan(convectiveTurbulence([], 4000))
  })

  it('lee rotor needs strong wind, a real ridge upwind and low height', () => {
    expect(rotorTurbulence(18, 900, 200)).toBeGreaterThan(2)
    expect(rotorTurbulence(4, 900, 200)).toBe(0) // light wind
    expect(rotorTurbulence(18, 50, 200)).toBe(0) // flat country
    expect(rotorTurbulence(18, 900, 2000)).toBe(0) // well above it
  })

  it('the strongest source wins, capped at severe', () => {
    expect(effectiveTurbulence(0.5, 2, 1)).toBe(2)
    expect(effectiveTurbulence(4, 0, 0)).toBe(3)
  })
})
