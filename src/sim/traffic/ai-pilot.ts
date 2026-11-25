/**
 * AI pattern pilot (§13, Phase 6d/6e): flies the standard pattern through
 * the SAME tower API and comms bus the player uses — requests takeoff,
 * calls downwind, waits for its landing clearance, goes around if it
 * reaches short final uncleared. Pure module; sim time only.
 */
import { TrafficPlane } from './pointmass'
import { makePatternLegs, DOWNWIND_LEG_INDEX, type PatternRunway } from './pattern'
import { TowerController, pilotPhrase, type PilotCallContext, type TrafficView } from '../atc/tower'
import { CommsBus, type Transmission } from '../atc/comms'
import { isAddressedTo, readbackText } from '../atc/phraseology'

export type AiPhase = 'waiting' | 'holdShort' | 'pattern' | 'landed' | 'taxiOff' | 'done'

export class AiPatternPilot {
  readonly plane: TrafficPlane
  phase: AiPhase = 'waiting'
  private clearedToLand = false
  private announcedDownwind = false
  private lastRequestAtS = -Infinity
  private lastViewAtS = -Infinity
  private readonly startDelayS: number

  constructor(
    private readonly cfg: {
      callsign: string
      runway: PatternRunway
      runwayIdent: string
      tower: TowerController
      bus: CommsBus
      freqMhz: number
      startDelayS?: number
      /** The tower's name and the ATIS letter held, spoken on every call ("Palo Alto Tower, Skyhawk 77GA, ..."). */
      facility?: string
      atis?: string
    },
  ) {
    this.startDelayS = cfg.startDelayS ?? 0
    this.plane = new TrafficPlane({
      lat: cfg.runway.thrLat,
      lon: cfg.runway.thrLon,
      altFt: cfg.runway.elevFt,
      gsKt: 0,
      headingDeg: cfg.runway.headingDeg,
    })
    cfg.bus.subscribe((t) => {
      if (t.text.startsWith(cfg.callsign) && t.text.toLowerCase().includes('cleared to land')) {
        this.clearedToLand = true
      }
      this.hear(t)
    })
  }

  get onGround(): boolean {
    return this.plane.altFt <= this.cfg.runway.elevFt + 15
  }

  get callsign(): string {
    return this.cfg.callsign
  }

  private view(): TrafficView {
    const mLat = 111_320
    const d = Math.hypot(
      (this.plane.lat - this.cfg.runway.thrLat) * mLat,
      (this.plane.lon - this.cfg.runway.thrLon) * mLat * Math.cos((this.plane.lat * Math.PI) / 180),
    )
    return { distanceM: d, aglFt: this.plane.altFt - this.cfg.runway.elevFt, onGround: this.onGround }
  }

  private say(text: string, atSimS: number, to?: string): void {
    this.cfg.bus.transmit({ freqMhz: this.cfg.freqMhz, from: this.cfg.callsign, text, atSimS, ...(to ? { to } : {}) })
  }

  /** Readbacks waiting for their moment: a pilot answers a second or two after the controller finishes. */
  private readonly readbacks: Array<{ dueS: number; text: string; freqMhz: number }> = []
  private nextReadbackJitter = 0

  /** An instruction addressed to this aircraft is read back, with the callsign last. */
  private hear(t: Transmission): void {
    if (t.from === this.cfg.callsign || !isAddressedTo(t, this.cfg.callsign)) return
    const text = readbackText(t, this.cfg.callsign)
    if (!text) return
    // 1.2–2.6 s: varies call to call, deterministically (no random source in the sim core).
    this.nextReadbackJitter = (this.nextReadbackJitter * 7 + 3) % 14
    this.readbacks.push({ dueS: t.atSimS + 1.2 + this.nextReadbackJitter / 10, text, freqMhz: t.freqMhz })
  }

  private flushReadbacks(atSimS: number): void {
    for (let i = this.readbacks.length - 1; i >= 0; i--) {
      const r = this.readbacks[i]!
      if (atSimS < r.dueS) continue
      this.readbacks.splice(i, 1)
      this.cfg.bus.transmit({ freqMhz: r.freqMhz, from: this.cfg.callsign, text: r.text, atSimS })
    }
  }

  private call(kind: Parameters<typeof pilotPhrase>[1]): string {
    const ctx: PilotCallContext = { ...(this.cfg.facility ? { facility: this.cfg.facility } : {}), ...(this.cfg.atis ? { atis: this.cfg.atis } : {}) }
    return pilotPhrase(this.cfg.callsign, kind, this.cfg.runwayIdent, ctx)
  }

  step(dt: number, atSimS: number): void {
    const c = this.cfg
    this.flushReadbacks(atSimS)
    if (this.phase === 'waiting') {
      if (atSimS >= this.startDelayS) this.phase = 'holdShort'
      return
    }
    if (this.phase === 'holdShort') {
      if (atSimS - this.lastRequestAtS > 15) {
        this.lastRequestAtS = atSimS
        this.say(this.call('readyTakeoff'), atSimS)
        const replies = c.tower.request(c.callsign, 'readyTakeoff', this.view(), atSimS)
        for (const r of replies) c.bus.transmit(r)
        if (replies.some((r) => r.text.toLowerCase().includes('cleared for takeoff'))) {
          this.plane.setLegs(makePatternLegs(c.runway, 'left'))
          this.phase = 'pattern'
        }
      }
      return
    }
    if (this.phase === 'pattern') {
      this.plane.step(dt)
      // Keep the tower's picture of us fresh.
      if (atSimS - this.lastViewAtS > 2) {
        this.lastViewAtS = atSimS
        c.tower.update(c.callsign, this.view())
      }
      const legIdx = this.plane.currentLeg() === null ? Infinity : this.plane.legIndex
      if (!this.announcedDownwind && legIdx > DOWNWIND_LEG_INDEX) {
        this.announcedDownwind = true
        this.say(`${c.facility ? `${c.facility}, ` : ''}${c.callsign}, left downwind runway ${c.runwayIdent}, full stop`, atSimS)
        c.tower.registerInbound(c.callsign, this.view())
      }
      // Short final without a clearance → go around.
      const v = this.view()
      if (!this.clearedToLand && !v.onGround && this.announcedDownwind && v.distanceM < 1400 && v.aglFt < 400) {
        this.say(this.call('goAround'), atSimS)
        for (const r of c.tower.request(c.callsign, 'goAround', v, atSimS)) c.bus.transmit(r)
        this.announcedDownwind = false
        this.clearedToLand = false
        this.plane.setLegs(makePatternLegs(c.runway, 'left'))
        return
      }
      if (this.plane.currentLeg() === null && this.onGround) {
        this.phase = 'landed'
        c.tower.update(c.callsign, { distanceM: 100, aglFt: 0, onGround: true })
      }
      return
    }
    if (this.phase === 'landed') {
      // 14e parked-forever fix: roll out and exit 60° off the runway
      // (pattern side), ~320 m to the hold point, then report clear.
      const mLat = 111_320
      const mLon = mLat * Math.cos((this.plane.lat * Math.PI) / 180)
      const exitRad = ((c.runway.headingDeg - 60) * Math.PI) / 180
      const exitM = 320
      this.plane.setLegs([{
        lat: this.plane.lat + (Math.cos(exitRad) * exitM) / mLat,
        lon: this.plane.lon + (Math.sin(exitRad) * exitM) / mLon,
        altFt: c.runway.elevFt,
        gsKt: 10,
        arriveM: 30,
      }])
      this.phase = 'taxiOff'
      return
    }
    if (this.phase === 'taxiOff') {
      this.plane.step(dt)
      if (this.plane.currentLeg() === null) {
        this.plane.gsKt = 0
        this.phase = 'done'
        this.say(this.call('clearRunway'), atSimS)
        for (const r of c.tower.request(c.callsign, 'clearRunway', this.view(), atSimS)) c.bus.transmit(r)
      }
      return
    }
    // 'done': parked clear of the runway.
  }
}
