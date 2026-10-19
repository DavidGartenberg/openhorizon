import type { Aircraft } from './aircraft'
import type { AircraftParams } from './aircraft/params'
import type { FuelState } from './systems/fuel'

export const KG_PER_LB = 0.45359237
export type MassUnit = 'kg' | 'lb'

export interface LoadingSelection {
  payloadKg: number
  leftKg: number
  rightKg: number
}

export interface LoadingValidation {
  valid: boolean
  overweight: boolean
  grossKg: number
  message: string
}

export function toDisplayMass(kg: number, unit: MassUnit): number {
  return unit === 'lb' ? kg / KG_PER_LB : kg
}

export function fromDisplayMass(value: number, unit: MassUnit): number {
  return unit === 'lb' ? value * KG_PER_LB : value
}

export function parseDisplayMass(raw: string, unit: MassUnit): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? fromDisplayMass(value, unit) : null
}

export function readLoadingDraft(
  canonical: LoadingSelection,
  displayed: Record<keyof LoadingSelection, string>,
  dirty: ReadonlySet<keyof LoadingSelection>,
  unit: MassUnit,
): LoadingSelection | null {
  const read = (key: keyof LoadingSelection) => dirty.has(key) ? parseDisplayMass(displayed[key], unit) : canonical[key]
  const payloadKg = read('payloadKg')
  const leftKg = read('leftKg')
  const rightKg = read('rightKg')
  return payloadKg === null || leftKg === null || rightKg === null ? null : { payloadKg, leftKg, rightKg }
}

export function defaultLoading(params: AircraftParams): LoadingSelection {
  const fuelKg = Math.max(params.fuelCapacityKg, 0)
  const usefulAfterFuelKg = Math.max(params.mtowKg - params.emptyMassKg - fuelKg, 0)
  return { payloadKg: Math.min(250, usefulAfterFuelKg), leftKg: fuelKg / 2, rightKg: fuelKg / 2 }
}

export function validateLoading(selection: LoadingSelection, params: AircraftParams): LoadingValidation {
  const values = [selection.payloadKg, selection.leftKg, selection.rightKg]
  const grossKg = params.emptyMassKg + selection.payloadKg + selection.leftKg + selection.rightKg
  if (!values.every(Number.isFinite)) return { valid: false, overweight: false, grossKg, message: 'Enter finite numbers for payload and both tanks.' }
  if (values.some(v => v < 0)) return { valid: false, overweight: false, grossKg, message: 'Payload and fuel cannot be negative.' }
  if (!(params.mtowKg > params.emptyMassKg)) return { valid: false, overweight: false, grossKg, message: 'Aircraft has no positive usable mass.' }
  const tankCapacityKg = params.fuelCapacityKg / 2
  if (selection.leftKg > tankCapacityKg) return { valid: false, overweight: false, grossKg, message: `Left tank exceeds its ${tankCapacityKg.toFixed(1)} kg capacity.` }
  if (selection.rightKg > tankCapacityKg) return { valid: false, overweight: false, grossKg, message: `Right tank exceeds its ${tankCapacityKg.toFixed(1)} kg capacity.` }
  const overweight = grossKg > params.mtowKg
  return {
    valid: true,
    overweight,
    grossKg,
    message: overweight ? `Warning: gross weight exceeds MTOW by ${(grossKg - params.mtowKg).toFixed(1)} kg.` : 'Loading is within MTOW.',
  }
}

export function applyLoading(
  selection: LoadingSelection,
  params: AircraftParams,
  aircraft: Pick<Aircraft, 'payloadKg' | 'fuelKg'>,
  fuelState: Pick<FuelState, 'leftKg' | 'rightKg'>,
  onGround: boolean,
): LoadingValidation & { applied: boolean } {
  const result = validateLoading(selection, params)
  if (!result.valid) return { ...result, applied: false }
  if (!onGround) return { ...result, applied: false, message: 'Land and stop before applying loading changes.' }
  aircraft.payloadKg = selection.payloadKg
  fuelState.leftKg = selection.leftKg
  fuelState.rightKg = selection.rightKg
  aircraft.fuelKg = selection.leftKg + selection.rightKg
  return { ...result, applied: true }
}

interface StoredPreference { selection: LoadingSelection; unit: MassUnit }
type Preferences = Record<string, StoredPreference>

// Avoid coupling pure loading logic to localStorage; the caller owns I/O.
function parsePreferences(raw: string | null): Preferences {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value as Preferences : {}
  } catch { return {} }
}

export function preferenceFor(raw: string | null, aircraftKey: string, params: AircraftParams): StoredPreference | null {
  const candidate = parsePreferences(raw)[aircraftKey]
  if (!candidate || !candidate.selection || (candidate.unit !== 'kg' && candidate.unit !== 'lb')) return null
  return validateLoading(candidate.selection, params).valid ? candidate : null
}

export function setPreference(raw: string | null, aircraftKey: string, selection: LoadingSelection, unit: MassUnit): string {
  return JSON.stringify({ ...parsePreferences(raw), [aircraftKey]: { selection: { ...selection }, unit } })
}

export interface LoadingSnapshot {
  payloadKg: number
  fuelKg: number
  fuelLeftKg?: number
  fuelRightKg?: number
}

export function loadingFromSnapshot(snapshot: LoadingSnapshot, params: AircraftParams): LoadingSelection {
  const split = snapshot.fuelKg / 2
  const selection = {
    payloadKg: snapshot.payloadKg,
    leftKg: snapshot.fuelLeftKg ?? split,
    rightKg: snapshot.fuelRightKg ?? split,
  }
  return validateLoading(selection, params).valid ? selection : defaultLoading(params)
}
