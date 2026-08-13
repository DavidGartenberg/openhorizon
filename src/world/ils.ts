/**
 * Global ILS table loader (night-shift N4): /api/ils.json carries every
 * true-ILS localizer on Earth (server pipeline over open navdata;
 * LDA/LOC-only excluded — the sim synthesizes straight-in LOC+GS from
 * runway geometry and must not impersonate offset or GS-less
 * approaches). On load the table replaces the AIP-verified offline seed
 * in the NAV tuning path.
 */
import { setIlsTable, type KnownIlsEntry } from '../sim/nav/tuning'

export let ilsLoaded = false
export let ilsCount = 0

export async function loadIls(): Promise<void> {
  try {
    const res = await fetch('/api/ils.json')
    if (!res.ok) throw new Error(`ils.json ${res.status}`)
    const raw = (await res.json()) as Record<string, { r: string; f: number; i: string; c: string }[]>
    const entries: KnownIlsEntry[] = []
    for (const [icao, list] of Object.entries(raw)) {
      for (const e of list) entries.push({ icao, runway: e.r, freqMhz: e.f / 100 })
    }
    setIlsTable(entries)
    ilsLoaded = true
    ilsCount = entries.length
  } catch {
    // Offline: the AIP-verified seed keeps the shakedown airports flyable.
    ilsLoaded = false
  }
}
