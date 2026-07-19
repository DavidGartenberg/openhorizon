/**
 * AI pattern pilot (§13, Phase 6d/6e): flies the standard pattern through
 * the SAME tower API and comms bus the player uses — requests takeoff,
 * calls downwind, waits for its landing clearance, goes around if it
 * reaches short final uncleared. Pure module; sim time only.
 */
import { TrafficPlane } from './pointmass'
import { makePatternLegs, DOWNWIND_LEG_INDEX, type PatternRunway } from './pattern'
import { TowerController, pilotPhrase, type TrafficView } from '../atc/tower'
import { CommsBus } from '../atc/comms'

export type AiPhase = 'waiting' | 'holdShort' | 'pattern' | 'landed'

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
    })
  }

  get onGround(): boolean {
    return this.plane.altFt <= this.cfg.runway.elevFt + 15
  }

  private view(): TrafficView {
    const mLat = 111_320
    const d = Math.hypot(
      (this.plane.lat - this.cfg.runway.thrLat) * mLat,
      (this.plane.lon - this.cfg.runway.thrLon) * mLat * Math.cos((this.plane.lat * Math.PI) / 180),
    )
    return { distanceM: d, aglFt: this.plane.altFt - this.cfg.runway.elevFt, onGround: this.onGround }
  }

  private say(text: string, atSimS: number): void {
    this.cfg.bus.transmit({ freqMhz: this.cfg.freqMhz, from: this.cfg.callsign, text, atSimS })
  }

  step(dt: number, atSimS: number): void {
    const c = this.cfg
    if (this.phase === 'waiting') {
      if (atSimS >= this.startDelayS) this.phase = 'holdShort'
      return
    }
    if (this.phase === 'holdShort') {
      if (atSimS - this.lastRequestAtS > 15) {
        this.lastRequestAtS = atSimS
        this.say(pilotPhrase(c.callsign, 'readyTakeoff', c.runwayIdent), atSimS)
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
        this.say(`${c.callsign}, left downwind runway ${c.runwayIdent}, full stop`, atSimS)
        c.tower.registerInbound(c.callsign, this.view())
      }
      // Short final without a clearance → go around.
      const v = this.view()
      if (!this.clearedToLand && !v.onGround && this.announcedDownwind && v.distanceM < 1400 && v.aglFt < 400) {
        this.say(pilotPhrase(c.callsign, 'goAround', c.runwayIdent), atSimS)
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
  }
}
