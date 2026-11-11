/**
 * Radio phraseology shared by the controllers, the AI pilots and the voice (pure).
 *
 * The strings built here are WRITTEN radio text ("runway 31, taxi via A, B,
 * hold short of runway 31"); `toSpokenAviation` turns them into what is said
 * ("runway three one, taxi via Alpha, Bravo ..."). Keeping one builder for an
 * instruction and its readback means the aircraft always reads back exactly
 * what the controller told it.
 */
import type { RadioArgs, RadioKind, Transmission } from './comms'

export type SpeakerRole = 'atc' | 'atis' | 'pilot'

const FACILITY_RX = /\b(tower|ground|approach|departure|center|centre|clearance|control|radar|radio|unicom|ctaf|information)\s*$/i

/** Who is talking: a facility ("Palo Alto Tower"), an ATIS broadcast, or an aircraft (anything else). */
export function speakerRole(from: string): SpeakerRole {
  const name = from.trim()
  if (/\bATIS\s*$/i.test(name)) return 'atis'
  return FACILITY_RX.test(name) ? 'atc' : 'pilot'
}

/** "Palo Alto Airport" → "Palo Alto"; the name a controller gives the field. */
export function fieldName(name: string): string {
  return name.replace(/\s+(International|Intl|Regional|Municipal|Memorial|Airport|Airfield|Field)\b.*$/i, '').trim() || name
}

/** "wind 290 at 8", "wind 290 at 12 gusting 18", "wind calm" (direction to the nearest ten degrees). */
export function windPhrase(dirDeg: number, speedKt: number, gustKt = 0): string {
  if (!(speedKt >= 1)) return 'wind calm'
  const dir = String(((Math.round(dirDeg / 10) * 10 + 359) % 360) + 1).padStart(3, '0')
  const gust = gustKt > speedKt + 3 ? ` gusting ${Math.round(gustKt)}` : ''
  return `wind ${dir} at ${Math.round(speedKt)}${gust}`
}

/** The taxi instruction, in the form the ground controller says it and the pilot reads it back. */
export function taxiInstruction(runway: string, via?: readonly string[]): string {
  return via && via.length
    ? `runway ${runway}, taxi via ${via.join(', ')}, hold short of runway ${runway}`
    : `runway ${runway}, taxi, hold short of runway ${runway}`
}

/** "contact departure 120.50", "contact tower 118.70". */
export function contactInstruction(facility: string, freqMhz: number): string {
  return `contact ${facility} ${freqMhz.toFixed(2)}`
}

/** What the addressed pilot reads back for an instruction (without the callsign they close with), or null when no readback is due. */
export function readbackFor(t: Pick<Transmission, 'kind' | 'args'>): string | null {
  const a: RadioArgs = t.args ?? {}
  const rwy = a.runway
  switch (t.kind as RadioKind | undefined) {
    case 'taxi': return rwy ? taxiInstruction(rwy, a.via) : null
    case 'holdShort': return rwy ? `hold short of runway ${rwy}` : null
    case 'takeoff': return rwy ? `runway ${rwy}, cleared for takeoff` : 'cleared for takeoff'
    case 'land': return rwy ? `runway ${rwy}, cleared to land` : 'cleared to land'
    case 'goAround': return 'fly runway heading'
    case 'contact': return a.facility && a.freqMhz ? contactInstruction(a.facility, a.freqMhz) : null
    case 'sequence': return a.number ? `number ${a.number}${a.report ? `, will report ${a.report}` : ''}` : null
    case 'approach': return rwy ? `cleared ILS runway ${rwy} approach${a.altitudeFt ? `, maintain ${a.altitudeFt.toLocaleString('en-US')} until established` : ''}` : null
    case 'descend': return a.altitudeFt ? `descend and maintain ${a.altitudeFt.toLocaleString('en-US')}` : null
    case 'climb': return a.altitudeFt ? `climb and maintain ${a.altitudeFt.toLocaleString('en-US')}${a.squawk ? `, squawk ${a.squawk}` : ''}` : null
    case 'turn': return a.headingDeg !== undefined ? `${a.direction ? `turn ${a.direction} ` : ''}heading ${String(a.headingDeg).padStart(3, '0')}` : null
    case 'squawk': return a.squawk ? `squawk ${a.squawk}` : null
    default: return null
  }
}

/** A pilot's readback transmission text: the instruction, then the callsign. */
export function readbackText(t: Pick<Transmission, 'kind' | 'args'>, callsign: string): string | null {
  const body = readbackFor(t)
  return body ? `${body}, ${callsign}` : null
}

/** True when a transmission is addressed to this callsign. */
export function isAddressedTo(t: Pick<Transmission, 'to' | 'text'>, callsign: string): boolean {
  return t.to === callsign || (t.to === undefined && t.text.startsWith(`${callsign},`))
}

// ---------------------------------------------------------------- traffic advisories

export interface TrafficPosition { lat: number; lon: number; trackDeg: number; altFt: number }

/** A target closer than this (nm) and within this height (ft) of the aircraft is called as traffic. */
export const TRAFFIC_CALL_NM = 3
export const TRAFFIC_CALL_ALT_FT = 1500

const BOUND = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

/**
 * The controller's traffic advisory: "traffic, 11 o'clock, 2 miles, southbound, Cherokee, altitude 2,500". Null when the target is too
 * far or too far above or below to matter. `type` is what a pilot would call it ("Cherokee"); empty is left out.
 */
export function trafficCall(own: TrafficPosition, target: TrafficPosition, type = ''): string | null {
  const mLat = 111_320
  const dn = (target.lat - own.lat) * mLat, de = (target.lon - own.lon) * mLat * Math.cos((own.lat * Math.PI) / 180)
  const nm = Math.hypot(dn, de) / 1852
  if (!(nm <= TRAFFIC_CALL_NM) || Math.abs(target.altFt - own.altFt) > TRAFFIC_CALL_ALT_FT) return null
  const bearing = ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360
  const clock = Math.round((((bearing - own.trackDeg + 360) % 360)) / 30) % 12 || 12
  const miles = Math.max(1, Math.round(nm))
  const bound = BOUND[Math.round((((target.trackDeg % 360) + 360) % 360) / 45) % 8]!
  const alt = Math.round(target.altFt / 100) * 100
  return `traffic, ${clock} o'clock, ${miles} ${miles === 1 ? 'mile' : 'miles'}, ${bound}bound, ${type ? `${type}, ` : ''}altitude ${alt.toLocaleString('en-US')}`
}
