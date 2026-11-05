/**
 * Callsigns as they are written in the sim and as people say them (pure).
 *
 * Written: "Skyhawk 123AB", "N77GA", "UAL2262", "BAW2KP".
 * Said:    "Skyhawk one two three Alpha Bravo", "November seven seven Golf Alpha",
 *          "United twenty two sixty two", "Speedbird two Kilo Papa".
 *
 * General-aviation callsigns are shortened to the last three characters once
 * the controller and pilot have been talking ("Skyhawk three Alpha Bravo");
 * airline flight numbers never are.
 */

export const NATO: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
  J: 'Juliet', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
}

/** ICAO three-letter airline designators → the telephony name said on the radio. */
export const AIRLINES: Record<string, string> = {
  UAL: 'United', AAL: 'American', DAL: 'Delta', SWA: 'Southwest', JBU: 'JetBlue', ASA: 'Alaska', SKW: 'SkyWest',
  FDX: 'FedEx', UPS: 'U P S', NKS: 'Spirit Wings', FFT: 'Frontier Flight', HAL: 'Hawaiian', AAY: 'Allegiant',
  EJA: 'Executive Jet', RPA: 'Brickyard', ENY: 'Envoy', EDV: 'Endeavor', QXE: 'Horizon Air', CPZ: 'Compass Rose',
  ACA: 'Air Canada', WJA: 'WestJet', BAW: 'Speedbird', VIR: 'Virgin', EZY: 'Easy', RYR: 'Ryanair', EIN: 'Shamrock',
  DLH: 'Lufthansa', AFR: 'Air France', KLM: 'K L M', IBE: 'Iberia', SWR: 'Swiss', AUA: 'Austrian', SAS: 'Scandinavian',
  FIN: 'Finnair', TAP: 'Air Portugal', ITY: 'Itarrow', BEL: 'Beeline', THY: 'Turkish', AEE: 'Aegean',
  UAE: 'Emirates', QTR: 'Qatari', ETD: 'Etihad', SVA: 'Saudia', ELY: 'El Al', MSR: 'Egypt Air', ETH: 'Ethiopian',
  SAA: 'Springbok', QFA: 'Qantas', ANZ: 'New Zealand', SIA: 'Singapore', CPA: 'Cathay', MAS: 'Malaysian',
  THA: 'Thai', JAL: 'Japan Air', ANA: 'All Nippon', KAL: 'Korean Air', AAR: 'Asiana', CCA: 'Air China',
  CES: 'China Eastern', CSN: 'China Southern', AIC: 'Air India', LAN: 'Lan', TAM: 'Tam', AVA: 'Avianca',
  AMX: 'Aeromexico', VOI: 'Volaris', GLO: 'Gol', ARG: 'Argentina',
}

/** General-aviation type words that stand in for the "November" of a tail number. */
export const GA_TYPE_WORDS = [
  'Skyhawk', 'Cessna', 'Skylane', 'Cardinal', 'Stationair', 'Caravan', 'Citation', 'Piper', 'Cherokee', 'Archer',
  'Warrior', 'Arrow', 'Seneca', 'Seminole', 'Navajo', 'Comanche', 'Beech', 'Bonanza', 'Baron', 'King Air',
  'Mooney', 'Cirrus', 'Diamond', 'Pilatus', 'Robinson', 'Citabria', 'Decathlon', 'Husky', 'Lancair', 'Twin Cessna',
] as const

export interface Callsign {
  raw: string
  kind: 'ga' | 'airline'
  /** GA: the type word ("Skyhawk"), when the written callsign has one. */
  type?: string
  /** GA: digits and letters after the N, "123AB". */
  tail?: string
  /** True when the written GA callsign starts with N ("N123AB"). */
  november?: boolean
  /** Airline: the spoken name ("United"), the flight digits, and trailing letters. */
  airline?: string
  flight?: string
  suffix?: string
}

const TYPE_RX = GA_TYPE_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')
/** One callsign inside running text: a type word + tail, an N-number, or an airline designator + number. */
const CALLSIGN_RX = new RegExp(
  `\\b(?:(${TYPE_RX})\\s+(N)?(\\d{1,5})([A-Z]{1,2})|(N)(\\d{1,5})([A-Z]{0,2})|([A-Z]{3})(\\d{1,4})([A-Z]{0,2}))\\b`, 'g',
)

function fromMatch(m: RegExpExecArray): Callsign | null {
  if (m[1]) return { raw: m[0], kind: 'ga', type: normalizeType(m[1]), tail: `${m[3]}${m[4]}`, november: !!m[2] }
  if (m[5]) {
    if (m[0].length < 3) return null
    return { raw: m[0], kind: 'ga', tail: `${m[6]}${m[7] ?? ''}`, november: true }
  }
  const name = AIRLINES[m[8]!]
  if (!name) return null
  return { raw: m[0], kind: 'airline', airline: name, flight: m[9]!, suffix: m[10] ?? '' }
}

function normalizeType(word: string): string {
  const w = word.replace(/\s+/g, ' ')
  return GA_TYPE_WORDS.find((t) => t.toLowerCase() === w.toLowerCase()) ?? w
}

/** Every callsign in `text`, with its position. */
export function findCallsigns(text: string): Array<{ start: number; end: number; callsign: Callsign }> {
  const out: Array<{ start: number; end: number; callsign: Callsign }> = []
  const rx = new RegExp(CALLSIGN_RX.source, 'g')
  for (let m = rx.exec(text); m; m = rx.exec(text)) {
    const callsign = fromMatch(m)
    if (callsign) out.push({ start: m.index, end: m.index + m[0].length, callsign })
  }
  return out
}

/** The callsign a written string is, or null. */
export function parseCallsign(text: string): Callsign | null {
  const found = findCallsigns(text.trim())
  return found.length === 1 && found[0]!.start === 0 && found[0]!.end === text.trim().length ? found[0]!.callsign : null
}

/** The last three characters of a GA tail: 123AB → "3AB" (one more when that would start with a zero: 590NN → "90NN"). */
export function abbreviatedTail(tail: string): string {
  const short = tail.slice(-3)
  return short.startsWith('0') && tail.length > 3 ? tail.slice(-4) : short
}

/** A stable key for "the same aircraft", whatever form it is written in. */
export function callsignKey(c: Callsign): string {
  return c.kind === 'ga' ? `ga:${c.tail}` : `al:${c.airline}:${c.flight}${c.suffix}`
}

/** The type word a pilot of this ICAO aircraft type says in front of the tail number. */
const TYPE_WORDS: Record<string, string> = {
  C172: 'Skyhawk', C182: 'Skylane', C152: 'Cessna', C150: 'Cessna', C177: 'Cardinal', C206: 'Stationair', C208: 'Caravan',
  C510: 'Citation', C525: 'Citation', C560: 'Citation', P28A: 'Cherokee', PA28: 'Cherokee', P28B: 'Cherokee', P28R: 'Arrow',
  PA32: 'Piper', PA34: 'Seneca', PA44: 'Seminole', PA46: 'Piper', SR20: 'Cirrus', SR22: 'Cirrus', BE36: 'Bonanza',
  BE35: 'Bonanza', BE33: 'Bonanza', BE58: 'Baron', BE55: 'Baron', BE20: 'King Air', BE9L: 'King Air', B350: 'King Air',
  M20P: 'Mooney', M20J: 'Mooney', M20T: 'Mooney', DA40: 'Diamond', DA42: 'Diamond', DA62: 'Diamond', PC12: 'Pilatus',
}

/** "N77GA" flown in a C172 → "Skyhawk 77GA": how the crew calls itself. Unknown types keep the N-number. */
export function radioCallsign(tail: string, icaoType: string): string {
  const word = TYPE_WORDS[icaoType.toUpperCase()]
  const m = /^N(\d{1,5}[A-Z]{0,2})$/.exec(tail.toUpperCase())
  return word && m ? `${word} ${m[1]}` : tail
}
