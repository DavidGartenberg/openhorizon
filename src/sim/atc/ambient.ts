/**
 * Background radio traffic (pure, seeded): other aircraft talking to the
 * controller on the frequency the player has tuned.
 *
 * A real frequency is never silent. Here, tune the ground, approach or
 * departure frequency of a towered field and complete exchanges happen on it:
 * a Skyhawk asks for taxi and reads the route back; an airliner checks in on
 * approach, is told to descend, and is handed to the tower; a departing
 * aircraft calls up climbing. The tower frequency is left to the AI pattern
 * pilots (the visible aircraft), and nothing here touches the tower's runway
 * strips, so background traffic never contradicts a clearance the player is
 * waiting for.
 *
 * Every line is flagged `ambient`: the voice plays it when the frequency is
 * quiet and puts the player's own exchange ahead of it.
 */
import type { RadioArgs, RadioKind, Transmission } from './comms'
import { contactInstruction, readbackText, taxiInstruction } from './phraseology'

export interface AmbientFacility {
  /** "Palo Alto Ground", "Norcal Approach": how the facility is called, and its frequency. */
  name: string
  freqMhz: number
}

export interface AmbientField {
  /** "Palo Alto" */
  field: string
  /** Active runway, "31". */
  runway: string
  /** ATIS letter in effect, "Bravo". */
  atis: string
  tower: AmbientFacility
  ground: AmbientFacility
  /** Approach and departure, when the field has frequencies of its own distinct from the tower's. */
  approach?: AmbientFacility
  departure?: AmbientFacility
  /** Real taxiway idents of the field, once known (the layout loads after the field is picked), for taxi routes. */
  taxiways?: () => readonly string[]
  /** 0 (quiet field) … 1 (busy hub): how often exchanges happen. */
  busy: number
  /** Airline traffic (a large airport) as well as general aviation. */
  airlines: boolean
}

type Line = { afterS: number; from: string; freqMhz: number; text: string; to?: string; kind?: RadioKind; args?: RadioArgs }

const GA_TYPES = ['Skyhawk', 'Cherokee', 'Cirrus', 'Bonanza', 'Skylane', 'Mooney', 'Warrior', 'Archer', 'Baron', 'Citation', 'Diamond']
const AIRLINE_CODES = ['UAL', 'AAL', 'DAL', 'SWA', 'JBU', 'ASA', 'SKW', 'FDX', 'UPS']
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

/** Small deterministic generator (mulberry32): the same seed always gives the same exchanges. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class AmbientRadio {
  private readonly rand: () => number
  private queue: Array<Line & { dueS: number }> = []
  private nextStartS = 0
  private lastFreq = -1
  private readonly used = new Set<string>()

  constructor(
    private field: AmbientField,
    options: { seed?: number } = {},
  ) {
    this.rand = rng(options.seed ?? 1)
  }

  setField(field: AmbientField): void {
    this.field = field
    this.queue = []
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rand() * items.length)]!
  }

  /** A callsign not used by anyone else (`taken`) nor by an earlier exchange still in the air. */
  private callsign(airline: boolean, taken: ReadonlySet<string>): string {
    for (let tries = 0; tries < 30; tries++) {
      let cs: string
      if (airline) cs = `${this.pick(AIRLINE_CODES)}${1 + Math.floor(this.rand() * 4999)}`
      else {
        const digits = String(1 + Math.floor(this.rand() * (this.rand() < 0.5 ? 99 : 999)))
        const letters = `${this.pick([...LETTERS])}${this.rand() < 0.6 ? this.pick([...LETTERS]) : ''}`
        cs = `${this.pick(GA_TYPES)} ${digits}${letters}`
      }
      if (!taken.has(cs) && !this.used.has(cs)) { this.used.add(cs); if (this.used.size > 40) this.used.delete(this.used.values().next().value as string); return cs }
    }
    return `Skyhawk ${1 + Math.floor(this.rand() * 99)}${this.pick([...LETTERS])}${this.pick([...LETTERS])}`
  }

  private squawk(): string {
    const d = (): number => Math.floor(this.rand() * 8)
    const code = `${1 + Math.floor(this.rand() * 6)}${d()}${d()}${d()}`
    return code === '1200' || code === '7500' || code === '7600' || code === '7700' ? '4321' : code
  }

  /** The aircraft calls the facility; the controller answers and the aircraft reads the instruction back. */
  private exchange(pilotFrom: string, fac: AmbientFacility, call: string, controllerText: string, kind: RadioKind, args: RadioArgs, gap = 0): Line[] {
    const answer = `${pilotFrom}, ${controllerText}`
    const readback = readbackText({ kind, args }, pilotFrom)
    return [
      { afterS: gap, from: pilotFrom, freqMhz: fac.freqMhz, text: call, to: fac.name },
      { afterS: gap + 3 + this.rand() * 2, from: fac.name, freqMhz: fac.freqMhz, text: answer, to: pilotFrom, kind, args },
      ...(readback ? [{ afterS: gap + 6 + this.rand() * 3, from: pilotFrom, freqMhz: fac.freqMhz, text: readback }] : []),
    ]
  }

  /** Ground: an aircraft at the ramp asks for taxi, is given a route, and reads it back. */
  private taxiExchange(taken: ReadonlySet<string>): Line[] {
    const f = this.field
    const airline = f.airlines && this.rand() < 0.6
    const cs = this.callsign(airline, taken)
    const known = f.taxiways?.() ?? []
    const via = known.length ? known.slice(0, 1 + Math.floor(this.rand() * 2)) : undefined
    const where = airline ? `gate ${1 + Math.floor(this.rand() * 40)}` : 'at the ramp'
    const call = `${f.ground.name}, ${cs}, ${where} with information ${f.atis}, ${airline ? 'ready to taxi' : 'request taxi for departure'}`
    return this.exchange(cs, f.ground, call, `${f.ground.name}, ${taxiInstruction(f.runway, via)}`, 'taxi', { runway: f.runway, ...(via ? { via } : {}) })
  }

  /** Approach: an aircraft checks in inbound, is given an altitude and then the tower frequency. */
  private arrivalExchange(app: AmbientFacility, taken: ReadonlySet<string>): Line[] {
    const f = this.field
    const airline = f.airlines && this.rand() < 0.65
    const cs = this.callsign(airline, taken)
    const miles = 8 + Math.floor(this.rand() * 18)
    const from = this.pick(COMPASS)
    const alt = airline ? this.pick([4000, 5000, 6000, 7000]) : this.pick([2500, 3500, 4500])
    const down = airline ? alt - 1000 : 2500
    const call = airline
      ? `${app.name}, ${cs}, ${alt.toLocaleString('en-US')}, information ${f.atis}`
      : `${app.name}, ${cs}, ${miles} miles ${from} at ${alt.toLocaleString('en-US')}, inbound with information ${f.atis}`
    const lines = this.exchange(cs, app, call, `${app.name}, radar contact${airline ? '' : `, squawk ${this.squawk()}`}, descend and maintain ${down.toLocaleString('en-US')}`, 'descend', { altitudeFt: down, runway: f.runway })
    const last = lines[lines.length - 1]!.afterS
    // The handoff is the controller speaking first: the exchange's empty opening call is dropped.
    const hand = this.exchange(cs, app, '', `${contactInstruction('tower', f.tower.freqMhz)}, good day`, 'contact', { facility: 'tower', freqMhz: f.tower.freqMhz }, last + 25 + this.rand() * 20)
    return [...lines, ...hand.slice(1)]
  }

  /** Departure: a climbing aircraft checks in and is given a squawk and altitude. */
  private departureExchange(dep: AmbientFacility, taken: ReadonlySet<string>): Line[] {
    const f = this.field
    const cs = this.callsign(f.airlines && this.rand() < 0.5, taken)
    const alt = this.pick([3000, 4000, 5000, 6000])
    const sq = this.squawk()
    const call = `${dep.name}, ${cs}, off ${f.field}, climbing ${alt.toLocaleString('en-US')}`
    return this.exchange(cs, dep, call, `${dep.name}, radar contact, climb and maintain ${alt.toLocaleString('en-US')}, squawk ${sq}`, 'climb', { altitudeFt: alt, squawk: sq })
  }

  /**
   * Transmissions due by `atSimS` on the frequency the player has tuned. Call every few seconds. `playerBusy` holds new exchanges
   * back while the player is in the middle of one; one exchange at a time, and none on the tower (the pattern pilots' frequency).
   */
  tick(atSimS: number, tunedMhz: number, playerBusy: boolean, taken: ReadonlySet<string> = new Set()): Transmission[] {
    const f = this.field
    const at = (fac?: AmbientFacility): boolean => !!fac && Math.abs(tunedMhz - fac.freqMhz) < 0.005
    const onGround = at(f.ground)
    const onApproach = at(f.approach)
    const onDeparture = at(f.departure)
    if (tunedMhz !== this.lastFreq) {
      // Tuning in: something is usually happening within a few seconds.
      this.lastFreq = tunedMhz
      this.queue = []
      this.nextStartS = atSimS + 4 + this.rand() * 10
    }
    if (f.busy <= 0 || !(onGround || onApproach || onDeparture)) return []
    if (!this.queue.length && !playerBusy && atSimS >= this.nextStartS) {
      // Busy hubs talk every ~35 s, quiet fields every ~2 minutes.
      this.nextStartS = atSimS + (110 - 75 * Math.min(1, f.busy)) * (0.6 + this.rand() * 0.8)
      const lines = onGround ? this.taxiExchange(taken)
        : onDeparture ? this.departureExchange(f.departure!, taken)
        : this.rand() < 0.3 ? this.departureExchange(f.approach!, taken) : this.arrivalExchange(f.approach!, taken)
      this.queue = lines.map((l) => ({ ...l, dueS: atSimS + l.afterS })).sort((a, b) => a.dueS - b.dueS)
    }
    const out: Transmission[] = []
    while (this.queue.length && this.queue[0]!.dueS <= atSimS) {
      const { dueS: _due, afterS: _after, ...line } = this.queue.shift()!
      // The player may have tuned away or started talking since: the rest of an exchange is simply not heard.
      if (playerBusy) continue
      out.push({ ...line, atSimS, ambient: true })
    }
    return out
  }
}
