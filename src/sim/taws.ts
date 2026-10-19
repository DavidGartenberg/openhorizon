/**
 * TAWS/GPWS (§15, Phase 7b): classic modes 1–6 plus forward-looking
 * terrain, presented on the C172 as G1000 TAWS-B (§15). Pure module: the
 * caller supplies AGL, a terrain-ahead sampler (backed by the streamed
 * heightfield), and approach context; alerts come out as typed events with
 * aural text, `newAural` firing once per transition. Envelope numbers are
 * simplified from the published GPWS curves and stated inline — shapes and
 * ordering are the contract (§24 tests), not certification exactness.
 */

export interface TawsInput {
  onGround?: boolean
  aglFt: number
  altFt: number
  vsFpm: number
  gsKt: number
  headingDeg: number
  rollDeg: number
  flapsDeg: number
  /** False for sailplanes without powered-aircraft landing flap procedures. */
  landingFlapWarning?: boolean
  /** Seconds since liftoff (Infinity/large when not in the takeoff phase). */
  sinceTakeoffS: number
  /** Terrain elevation (ft MSL) at `lookaheadS` seconds along track. */
  terrainAheadFt: (lookaheadS: number) => number
  /** Within ~4 nm of a runway, roughly aligned — inhibits modes 2/4 and
   *  the look-ahead so normal landings stay silent. */
  nearRunwayFinal: boolean
  /** ILS glideslope deviation fraction (fly-up negative), null when none. */
  gsDeviation: number | null
  /** Jet GPWS profile (Phase 11f, 737): enables Mode-4A "TOO LOW, GEAR" and
   *  the FIFTY…TEN short-final callouts. Absent = TAWS-B (C172) behavior. */
  jetProfile?: boolean
  /** Landing gear down-and-locked; only meaningful with jetProfile. */
  gearDown?: boolean
}

export type TawsLevel = 'NONE' | 'CAUTION' | 'WARNING'

export interface TawsOutput {
  level: TawsLevel
  aural?: string
  newAural: boolean
  callout?: boolean
}

const JET_CALLOUT_GATES: ReadonlyArray<[number, string]> = [
  [50, 'FIFTY'], [40, 'FORTY'], [30, 'THIRTY'], [20, 'TWENTY'], [10, 'TEN'],
]

export class TawsComputer {
  private lastAural: string | undefined
  private maxAglSinceTakeoff = 0
  private prevAglFt: number | undefined
  private crossed = new Set<number>()
  reset(): void { this.lastAural = undefined; this.maxAglSinceTakeoff = 0; this.prevAglFt = undefined; this.crossed.clear() }

  step(dt: number, inp: TawsInput): TawsOutput {
    void dt
    if (inp.onGround || (inp.gsKt < 30 && inp.aglFt < 30)) {
      this.reset()
      return { level: 'NONE', newAural: false }
    }
    let level: TawsLevel = 'NONE'
    let aural: string | undefined

    const consider = (lvl: TawsLevel, text: string) => {
      const rank = (l: TawsLevel) => (l === 'WARNING' ? 2 : l === 'CAUTION' ? 1 : 0)
      if (rank(lvl) > rank(level)) {
        level = lvl
        aural = text
      }
    }

    // ---- Mode 1: excessive descent rate vs AGL (simplified envelope:
    // caution when sink exceeds ~2.5×AGL fpm below 2500; warning ~4×AGL).
    // Armed only above 30 ft (15a): gear-compression vs spikes during
    // rollout/spawn fired SINK RATE while parked — real Mode 1 arms off
    // the radio-altimeter floor too. ----
    const sink = -inp.vsFpm
    if (inp.aglFt > 30 && inp.aglFt < 2500 && sink > 1000) {
      if (sink > Math.max(1.6 * inp.aglFt, 1600)) consider('WARNING', 'PULL UP')
      else if (sink > Math.max(0.9 * inp.aglFt, 1200)) consider('CAUTION', 'SINK RATE')
    }

    // ---- Forward-looking terrain (and classic mode 2 closure) ----
    if (!inp.nearRunwayFinal && inp.gsKt > 40 && inp.aglFt > 30) {
      const alt30 = inp.altFt + (inp.vsFpm / 60) * 30
      const alt60 = inp.altFt + (inp.vsFpm / 60) * 60
      const terr30 = inp.terrainAheadFt(30)
      const terr60 = inp.terrainAheadFt(60)
      if (alt30 - terr30 < 300) consider('WARNING', 'TERRAIN AHEAD, PULL UP')
      else if (alt60 - terr60 < 500) consider('CAUTION', 'TERRAIN AHEAD')
    }

    // ---- Mode 3: altitude loss after takeoff ----
    if (inp.sinceTakeoffS < 60 && inp.aglFt < 700) {
      this.maxAglSinceTakeoff = Math.max(this.maxAglSinceTakeoff, inp.aglFt)
      if (this.maxAglSinceTakeoff - inp.aglFt > 30 && inp.vsFpm < -100) {
        consider('CAUTION', "DON'T SINK")
      }
    } else if (inp.sinceTakeoffS > 120) {
      this.maxAglSinceTakeoff = 0
    }

    // ---- Mode 4: too low in cruise configuration ----
    if (inp.landingFlapWarning !== false && (!inp.nearRunwayFinal || inp.jetProfile) && inp.sinceTakeoffS > 60 && inp.aglFt < 245 && inp.gsKt > 60 && inp.flapsDeg < 10 && !(inp.jetProfile && inp.gearDown === false)) {
      consider('CAUTION', 'TOO LOW, FLAPS')
    }
    // Mode 4A (jet): gear up low and slow — deliberately NOT inhibited near
    // the runway; a gear-up approach is exactly what this mode exists for.
    if (inp.jetProfile && inp.sinceTakeoffS > 60 && inp.gearDown === false && inp.aglFt < 500 && inp.gsKt > 60) {
      consider('CAUTION', 'TOO LOW, GEAR')
    }

    // ---- Mode 5: below the glideslope on approach ----
    // Deliberately NOT gated on `nearRunwayFinal`: that flag's incoming
    // runway-corridor envelope exists to inhibit modes 2/4 during normal
    // landings, and borrowing it here capped glideslope protection at the
    // last ~2.5 nm of final — an EGLL acceptance flight dragged in 600 ft
    // below the beam at 4.5 nm, established and receiving, in silence.
    // "Established on a receivable ILS" (gsDeviation non-null via the 15a
    // ilsOnFinal feed gate) below 1000 AGL is the honest Mode-5 envelope.
    if (inp.gsDeviation !== null && inp.gsDeviation < -0.35 && inp.aglFt < 1000 && inp.aglFt > 150) {
      consider('CAUTION', 'GLIDESLOPE')
    }

    // ---- Mode 6: callouts + bank angle ----
    if (Math.abs(inp.rollDeg) > 45) consider('CAUTION', 'BANK ANGLE')
    // Crossings, never a backlog. A go-around rearms only gates climbed above.
    const gates: ReadonlyArray<readonly [number, string]> = inp.jetProfile ? [[500, 'FIVE HUNDRED'], ...JET_CALLOUT_GATES] : [[500, 'FIVE HUNDRED']]
    let callout: string | undefined
    for (const [gate, text] of gates) {
      if (inp.aglFt > gate + Math.max(10, gate * 0.1)) this.crossed.delete(gate)
      if (this.prevAglFt !== undefined && this.prevAglFt > gate && inp.aglFt <= gate && inp.vsFpm < 0 && inp.gsKt > 40 && !this.crossed.has(gate)) {
        this.crossed.add(gate)
        callout = text
      }
    }
    this.prevAglFt = inp.aglFt
    if (level === 'NONE') aural = callout

    const newAural = aural !== undefined && aural !== this.lastAural
    this.lastAural = aural
    return { level, aural, newAural, callout: level === 'NONE' && !!aural }
  }
}
