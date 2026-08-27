/**
 * Boundary guards (Slice 0): the finite-number gate for debug hooks and
 * other unvalidated entry points. Garbage (NaN, Infinity, non-numeric
 * strings, booleans, objects) must never reach sim state — one NaN
 * through `__ohRate` freezes the physics accumulator permanently, and a
 * string through a control hook NaN-poisons every force downstream.
 *
 * Numeric strings are accepted (console verification convenience:
 * `__ohWind('280', '12')`), but the empty string is rejected — bare
 * Number('') is 0, which would turn a typo into a silent value.
 */
export function finiteOr(v: unknown): number | null
export function finiteOr(v: unknown, fallback: number): number
export function finiteOr(v: unknown, fallback: number | null = null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}
