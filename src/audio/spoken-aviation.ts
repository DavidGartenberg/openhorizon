/**
 * Written aviation text → what a person on the radio actually says (pure).
 *
 * A speech engine reads "28L" as "twenty-eight L" and "118.70" as "one
 * hundred eighteen point seven zero". Controllers and crews say neither:
 * runway two eight left, frequency one one eight point seven, squawk four
 * five two one, Skyhawk one two three Alpha Bravo. This module rewrites the
 * text the sim already produces into that phraseology before it reaches the
 * voice (the displayed/typed text is never changed). It is idempotent, so a
 * line that is already spoken passes through untouched.
 *
 * US (FAA) phraseology keeps three and five as words and borrows only "niner";
 * `style: 'icao'` is what controllers outside North America say: "tree", "fife",
 * "decimal", winds in degrees and knots.
 */
import { findCallsigns, abbreviatedTail, callsignKey, NATO, type Callsign } from '../sim/atc/callsign'

export type PhraseStyle = 'faa' | 'icao'

/** ICAO ident → the phraseology its controllers use: North America (K, P, C, TJ, TI) speaks FAA style. */
export function styleForAirport(icao: string): PhraseStyle {
  // No field (a transmission finishing after the facility was left) keeps the default, US phraseology.
  return !icao || /^(K|P[A-Z]|C[A-Z]|TJ|TI|MM)/i.test(icao) ? 'faa' : 'icao'
}

/**
 * Which callsigns have been said lately, so general-aviation ones can be shortened once the exchange is under way
 * ("Skyhawk one two three Alpha Bravo" → "Skyhawk three Alpha Bravo"). Airline flight numbers are never shortened.
 */
export class CallsignBook {
  private readonly seen = new Map<string, number[]>()
  constructor(private readonly options: { shortAfter?: number; ttlMs?: number } = {}) {}
  /** True when this aircraft has been addressed `shortAfter` times (default 2) within the window; records the mention. */
  mention(callsign: Callsign, nowMs: number): boolean {
    const key = callsignKey(callsign), ttl = this.options.ttlMs ?? 600_000
    const times = (this.seen.get(key) ?? []).filter((t) => nowMs - t < ttl)
    const short = callsign.kind === 'ga' && times.length >= (this.options.shortAfter ?? 2)
    times.push(nowMs)
    this.seen.set(key, times)
    if (this.seen.size > 200) this.seen.delete(this.seen.keys().next().value as string)
    return short
  }
  reset(): void { this.seen.clear() }
}

export interface SpokenOptions {
  style?: PhraseStyle
  /** Shorten general-aviation callsigns that have already been said; `nowMs` is the clock the book is kept on. */
  callsigns?: CallsignBook
  nowMs?: number
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

const ACRONYMS: Record<string, string> = {
  ILS: 'I L S', VOR: 'V O R', GPS: 'G P S', VFR: 'V F R', IFR: 'I F R', ATC: 'A T C', DME: 'D M E', NDB: 'N D B',
  AGL: 'A G L', MSL: 'M S L', UTC: 'U T C', FMS: 'F M S', GPWS: 'G P W S', EGPWS: 'E G P W S', TAWS: 'Taws',
  ATIS: 'Ay-tiss', TCAS: 'Tee-cas', RNAV: 'R-nav', TACAN: 'Tack-an', METAR: 'Meh-tar', NOTAM: 'No-tam',
  CTAF: 'See-taf',
}

/** ICAO pronunciations: three → "tree", five → "fife" (nine is "niner" in both styles). */
const ICAO_ONES = ['zero', 'one', 'two', 'tree', 'four', 'fife', 'six', 'seven', 'eight', 'nine']
let digitStyle: PhraseStyle = 'faa'
/** Digit by digit, with "niner" (and "tree" / "fife" in ICAO style). */
const digits = (s: string): string => [...s].map((c) => (c === '9' ? 'niner' : (digitStyle === 'icao' ? ICAO_ONES : ONES)[+c] ?? c)).join(' ')
const letter = (c: string): string => NATO[c.toUpperCase()] ?? c

/** 0–99 as ordinary number words. */
function pairWords(n: number): string {
  if (n < 10) return ONES[n]!
  if (n < 20) return TEENS[n - 10]!
  return TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : '')
}

/** How controllers group a flight number: 2262 → "twenty two sixty two",
 *  987 → "nine eighty seven", 1200 → "twelve hundred", 45 → "forty five". */
function grouped(num: string): string {
  const pair = (p: string): string => (p[0] === '0' ? `oh ${ONES[+p[1]!]}` : pairWords(+p))
  if (num.length === 1) return digits(num)
  if (num.length === 2) return num[0] === '0' ? `zero ${ONES[+num[1]!]}` : pairWords(+num)
  if (num.length === 3) return `${digits(num[0]!)} ${num.slice(1) === '00' ? 'hundred' : pair(num.slice(1))}`
  if (num.length === 4) return `${pair(num.slice(0, 2))} ${num.slice(2) === '00' ? 'hundred' : pair(num.slice(2))}`
  return digits(num)
}

/** An altitude: 3,000 → "three thousand", 12,000 → "one two thousand",
 *  2,500 → "two thousand five hundred", 800 → "eight hundred". */
function altitude(n: number): string {
  const thousands = Math.floor(n / 1000), rem = n % 1000
  const parts: string[] = []
  if (thousands > 0) parts.push(`${thousands < 10 ? digits(String(thousands)) : digits(String(thousands))} thousand`)
  if (rem > 0) parts.push(rem % 100 === 0 ? `${digits(String(rem / 100))} hundred` : grouped(String(rem)))
  return parts.join(' ') || 'zero'
}

const SIDE: Record<string, string> = { L: 'left', R: 'right', C: 'center' }

/** A callsign as it is said: the type word (or "November") then digits and letters, short form when asked. */
function spokenCallsign(c: Callsign, short: boolean): string {
  if (c.kind === 'airline') return `${c.airline} ${grouped(c.flight!)}${c.suffix ? ' ' + [...c.suffix].map(letter).join(' ') : ''}`
  const tail = short ? abbreviatedTail(c.tail!) : c.tail!
  const m = /^(\d*)([A-Z]*)$/.exec(tail)!
  const body = [m[1] ? digits(m[1]) : '', ...[...m[2]!].map(letter)].filter(Boolean).join(' ')
  const lead = c.type ?? (c.november && !short ? 'November' : '')
  return lead ? `${lead} ${body}` : body
}

export function toSpokenAviation(text: string, options: SpokenOptions = {}): string {
  if (!text.trim()) return text
  const style = options.style ?? 'faa'
  digitStyle = style
  try {
    return convert(text, style, options)
  } finally {
    digitStyle = 'faa'
  }
}

function convert(text: string, style: PhraseStyle, options: SpokenOptions): string {
  let t = text

  // ---- callsigns first, so their digits are not split by later rules ----
  const found = findCallsigns(t)
  for (let k = found.length - 1; k >= 0; k--) {
    const { start, end, callsign } = found[k]!
    const short = options.callsigns ? options.callsigns.mention(callsign, options.nowMs ?? Date.now()) : false
    t = t.slice(0, start) + spokenCallsign(callsign, short) + t.slice(end)
  }

  // ---- frequencies, altimeter, squawk, flight level, wind, headings ----
  t = t.replace(/\b(1[0-3]\d)\.(\d{1,3})\b/g, (_m, a: string, b: string) => {
    const dec = b.replace(/0+$/, '')
    return `${digits(a)} ${style === 'icao' ? 'decimal' : 'point'} ${dec ? digits(dec) : 'zero'}`
  })
  t = t.replace(/\b(altimeter|QNH)\s+(\d{2})\.(\d{2})\b/gi, (_m, w: string, a: string, b: string) =>
    style === 'icao' ? `QNH ${digits(String(Math.round((+a + +b / 100) * 33.8639)))}` : `${w} ${digits(a + b)}`)
  t = t.replace(/\b(squawk)\s+(\d{4})\b/gi, (_m, w: string, n: string) => `${w} ${digits(n)}`)
  t = t.replace(/\bFL\s?(\d{2,3})\b/g, (_m, n: string) => `flight level ${digits(n)}`)
  t = t.replace(/\b(wind)\s+(\d{3})\s+at\s+(\d{1,3})(?:\s+(gusting)\s+(\d{1,3}))?/gi,
    (_m, w: string, dir: string, spd: string, g?: string, gust?: string) =>
      style === 'icao'
        ? `${w} ${digits(dir)} degrees ${digits(spd)} knots${g ? ` maximum ${digits(gust!)}` : ''}`
        : `${w} ${digits(dir)} at ${digits(spd)}${g ? ` ${g} ${digits(gust!)}` : ''}`)
  t = t.replace(/\b(heading|hdg|course|radial|bearing|track)\s+(\d{3})\b/gi, (_m, w: string, n: string) =>
    `${w.toLowerCase() === 'hdg' ? 'heading' : w} ${digits(n)}`)

  // ---- runways ----
  t = t.replace(/\b(runway|rwy)\s+(\d{1,2})([LRC])?\b/gi, (_m, w: string, n: string, s?: string) =>
    `${w.toLowerCase() === 'rwy' ? 'runway' : w} ${digits(n.length === 1 ? n : n)}${s ? ' ' + SIDE[s.toUpperCase()] : ''}`)
  t = t.replace(/\b(0?[1-9]|[12]\d|3[0-6])([LRC])\b/g, (_m, n: string, s: string) => `${digits(n)} ${SIDE[s]}`)

  // ---- times: "1805 zulu" is said digit by digit ----
  t = t.replace(/\b(\d{4})\s*(zulu|Z)\b/gi, (_m, n: string) => `${digits(n)} Zulu`)

  // ---- weather: visibility is said digit by digit, cloud bases as altitudes ----
  t = t.replace(/\b(visibility)\s+(\d{1,2})\b(?!\s*\/|\.\d)/gi, (_m, w: string, n: string) => `${w} ${digits(n)}`)
  t = t.replace(/\b(few clouds|scattered clouds|broken clouds|overcast|ceiling)\s+(?:at\s+)?(\d{3,5})\b/gi,
    (m, _w: string, n: string) => m.slice(0, m.length - n.length) + altitude(+n))

  // ---- speeds, altitudes, units ----
  t = t.replace(/\b(\d{2,3})\s?(?:kts?|knots)\b/gi, (_m, n: string) => `${digits(n)} knots`)
  t = t.replace(/\b(\d{1,2}),(\d{3})\b/g, (_m, a: string, b: string) => altitude(+a * 1000 + +b))
  t = t.replace(/\b(maintain|climb|descend|climbing|descending|altitude|expect|cleared to|climb to|descend to)\s+(\d{4,5})\b/gi,
    (_m, w: string, n: string) => `${w} ${altitude(+n)}`)
  t = t.replace(/\b(\d{3,5})\s?(?:feet|ft)\b/gi, (_m, n: string) => `${altitude(+n)} feet`)
  t = t.replace(/\bfpm\b/gi, 'feet per minute')
  t = t.replace(/\bnm\b/g, 'nautical miles')
  t = t.replace(/\bhPa\b/g, 'hectopascals')
  t = t.replace(/\bkts?\b/g, 'knots')
  t = t.replace(/\bft\b/g, 'feet')

  // ---- taxiways and ATIS letters ----
  t = t.replace(/\b(via)\s+([A-Z]\d?(?![A-Za-z0-9])(?:\s*,\s*[A-Z]\d?(?![A-Za-z0-9]))*)/g, (_m, w: string, list: string) =>
    `${w} ${list.replace(/[A-Z]\d?/g, (tok) => letter(tok[0]!) + (tok[1] ? ' ' + ONES[+tok[1]] : ''))}`)
  t = t.replace(/\b(taxiway|hold short of|exit|continue on|turn (?:left|right) (?:on|onto)|proceed on|cross)\s+([A-Z]\d?)(?![A-Za-z0-9])/g,
    (_m, w: string, tok: string) => `${w} ${letter(tok[0]!)}${tok[1] ? ' ' + ONES[+tok[1]] : ''}`)
  t = t.replace(/\b(information)\s+([A-Z])\b(?![A-Za-z])/g, (_m, w: string, c: string) => `${w} ${letter(c)}`)

  // ---- airways (V25 → Victor twenty five) and K-idents (KSFO → S F O) ----
  t = t.replace(/\b([VJ])(\d{2,3})\b/g, (_m, a: string, n: string) => `${letter(a)} ${grouped(n)}`)
  t = t.replace(/\bK([A-Z]{3})\b/g, (_m, id: string) => [...id].join(' '))

  // ---- acronyms ----
  t = t.replace(/\b[A-Z]{2,6}\b/g, (m) => ACRONYMS[m] ?? m)
  return t
}
