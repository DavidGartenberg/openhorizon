/**
 * What the environment did to this flight, for the landing debrief and the
 * logbook: g extremes, overstress / structural failure, windshear alerts,
 * the most ice carried, hydroplaning. Events are logged from takeoff; the
 * debrief clause reports only what happened.
 */
import type { EnvironmentEventKind } from './environment'

export interface FlightEvent { t: number; kind: EnvironmentEventKind; text: string }

export class FlightEventLog {
  readonly events: FlightEvent[] = []
  maxIceMm = 0

  add(t: number, kind: EnvironmentEventKind, text: string): void {
    this.events.push({ t, kind, text })
    if (this.events.length > 200) this.events.shift()
  }

  noteIce(mm: number): void {
    this.maxIceMm = Math.max(this.maxIceMm, mm)
  }

  reset(): void {
    this.events.length = 0
    this.maxIceMm = 0
  }

  kinds(): EnvironmentEventKind[] {
    return [...new Set(this.events.map((e) => e.kind))]
  }
}

/** One debrief clause, e.g. "MAX 3.4 G · OVERSTRESS · WINDSHEAR ×2 · ICE 2.1 MM". */
export function environmentDebrief(log: FlightEventLog, maxG: number, minG: number): string {
  const n = (k: EnvironmentEventKind): number => log.events.filter((e) => e.kind === k).length
  const parts: string[] = []
  if (maxG >= 2) parts.push(`MAX ${maxG.toFixed(1)} G`)
  if (minG < 0) parts.push(`MIN ${minG.toFixed(1)} G`)
  if (n('failure')) parts.push('STRUCTURAL FAILURE')
  else if (n('overstress')) parts.push('OVERSTRESS')
  if (n('windshear')) parts.push(`WINDSHEAR ×${n('windshear')}`)
  if (log.maxIceMm >= 0.5) parts.push(`ICE ${log.maxIceMm.toFixed(1)} MM`)
  if (n('hydroplaning')) parts.push('HYDROPLANED')
  return parts.join(' · ')
}
