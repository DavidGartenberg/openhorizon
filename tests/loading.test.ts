import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { C172S } from '../src/sim/aircraft/c172s'
import { J3CUB } from '../src/sim/aircraft/j3cub'
import { B738 } from '../src/sim/aircraft/b738'
import { makeFuelState, stepFuel } from '../src/sim/systems/fuel'
import {
  KG_PER_LB, applyLoading, defaultLoading, fromDisplayMass, loadingFromSnapshot,
  parseDisplayMass, readLoadingDraft, preferenceFor, setPreference, toDisplayMass, validateLoading,
} from '../src/sim/loading'

describe('loading', () => {
  it('converts kg and lb without changing internal kg', () => {
    expect(toDisplayMass(10, 'kg')).toBe(10)
    expect(toDisplayMass(10, 'lb')).toBeCloseTo(22.0462, 4)
    expect(fromDisplayMass(22.0462, 'lb')).toBeCloseTo(10, 4)
  })

  it('rejects blank display fields instead of silently treating them as zero', () => {
    expect(parseDisplayMass('', 'kg')).toBeNull()
    expect(parseDisplayMass('   ', 'lb')).toBeNull()
    expect(parseDisplayMass('12.5', 'kg')).toBe(12.5)
  })

  it('retains canonical full tanks when rounded display values are untouched', () => {
    const canonical = defaultLoading(C172S)
    const displayed = {
      payloadKg: toDisplayMass(canonical.payloadKg, 'lb').toFixed(1),
      leftKg: toDisplayMass(canonical.leftKg, 'lb').toFixed(1),
      rightKg: toDisplayMass(canonical.rightKg, 'lb').toFixed(1),
    }
    const result = readLoadingDraft(canonical, displayed, new Set(), 'lb')
    expect(result).toEqual(canonical)
    expect(validateLoading(result!, C172S).valid).toBe(true)
  })

  it.each([
    [{ payloadKg: Number.NaN, leftKg: 1, rightKg: 1 }, 'Enter finite numbers'],
    [{ payloadKg: -1, leftKg: 1, rightKg: 1 }, 'cannot be negative'],
    [{ payloadKg: 1, leftKg: C172S.fuelCapacityKg, rightKg: 1 }, 'Left tank'],
  ])('rejects invalid loading %o', (selection, message) => {
    const result = validateLoading(selection, C172S)
    expect(result.valid).toBe(false)
    expect(result.message).toContain(message)
  })

  it('permits a deliberate overweight loading with a clear aircraft-specific warning', () => {
    const selection = { payloadKg: 500, leftKg: 50, rightKg: 50 }
    const result = validateLoading(selection, C172S)
    expect(result.valid).toBe(true)
    expect(result.overweight).toBe(true)
    expect(result.message).toContain('MTOW')
    expect(result.grossKg).toBeCloseTo(C172S.emptyMassKg + 600)
  })

  it('applies payload and both fuel ledgers transactionally only on the ground', () => {
    const aircraft = new Aircraft(C172S)
    const fuel = makeFuelState(10, 20)
    stepFuel(fuel, 0, { selector: 'L', boostPumpOn: true, demandKgS: 0 })
    const selection = { payloadKg: 100, leftKg: 30, rightKg: 25 }
    expect(applyLoading(selection, C172S, aircraft, fuel, false).applied).toBe(false)
    expect([aircraft.payloadKg, fuel.leftKg, fuel.rightKg]).toEqual([250, 10, 20])
    expect(applyLoading(selection, C172S, aircraft, fuel, true).applied).toBe(true)
    expect([aircraft.payloadKg, aircraft.fuelKg, fuel.leftKg, fuel.rightKg]).toEqual([100, 55, 30, 25])
    expect([fuel._lastSelector, fuel.boostPumpOn, fuel.fuelFlowing]).toEqual(['L', true, true])
    stepFuel(fuel, 10, { selector: 'L', boostPumpOn: false, demandKgS: 0.1 })
    aircraft.fuelKg = fuel.leftKg + fuel.rightKg
    expect([fuel.leftKg, fuel.rightKg, aircraft.fuelKg]).toEqual([29, 25, 54])
    expect(aircraft.massKg).toBeCloseTo(C172S.emptyMassKg + 154)
  })

  it('bounds defaults by each type useful load while retaining established valid payloads', () => {
    expect(defaultLoading(C172S).payloadKg).toBe(250)
    expect(defaultLoading(B738).payloadKg).toBe(250)
    const glider = defaultLoading({ ...J3CUB, emptyMassKg: 500, mtowKg: 600, fuelCapacityKg: 1 })
    expect(glider.payloadKg).toBe(99)
    expect(500 + glider.payloadKg + glider.leftKg + glider.rightKg).toBe(600)
    expect(new Aircraft(C172S).payloadKg).toBe(250)
    expect(new Aircraft(B738).payloadKg).toBe(250)
    expect(new Aircraft(J3CUB).massKg).toBeLessThanOrEqual(J3CUB.mtowKg)
  })

  it('keeps preferences independent per aircraft and ignores malformed entries', () => {
    let raw: string | null = null
    raw = setPreference(raw, '172', { payloadKg: 90, leftKg: 20, rightKg: 21 }, 'lb')
    raw = setPreference(raw, '737', { payloadKg: 1000, leftKg: 2000, rightKg: 2100 }, 'kg')
    expect(preferenceFor(raw, '172', C172S)?.selection.leftKg).toBe(20)
    expect(preferenceFor(raw, '737', B738)?.selection.leftKg).toBe(2000)
    expect(preferenceFor('{bad', '172', C172S)).toBeNull()
    expect(preferenceFor('{"172":{"unit":"kg"}}', '172', C172S)).toBeNull()
  })

  it('restores new tank imbalance and splits backward-compatible total-only snapshots', () => {
    expect(loadingFromSnapshot({ payloadKg: 80, fuelKg: 50, fuelLeftKg: 10, fuelRightKg: 40 }, C172S))
      .toEqual({ payloadKg: 80, leftKg: 10, rightKg: 40 })
    expect(loadingFromSnapshot({ payloadKg: 80, fuelKg: 50 }, C172S))
      .toEqual({ payloadKg: 80, leftKg: 25, rightKg: 25 })
  })

  it('uses the exact pounds conversion constant', () => {
    expect(KG_PER_LB).toBe(0.45359237)
  })
})
