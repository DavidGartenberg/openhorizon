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
  aglFt: number
  altFt: number
  vsFpm: number
  gsKt: number
  headingDeg: number
  rollDeg: number
  flapsDeg: number
  /** Seconds since liftoff (Infinity/large when not in the takeoff phase). */
  sinceTakeoffS: number
  /** Terrain elevation (ft MSL) at `lookaheadS` seconds along track. */
  terrainAheadFt: (lookaheadS: number) => number
  /** Within ~4 nm of a runway, roughly aligned — inhibits modes 2/4 and
   *  the look-ahead so normal landings stay silent. */
  nearRunwayFinal: boolean
  /** ILS glideslope deviation fraction (fly-up negative), null when none. */
  gsDeviation: number | null
}

export type TawsLevel = 'NONE' | 'CAUTION' | 'WARNING'

export interface TawsOutput {
  level: TawsLevel
  aural?: string
  newAural: boolean
}

export class TawsComputer {
  private lastAural: string | undefined
  private maxAglSinceTakeoff = 0
  private said500 = false

  step(dt: number, inp: TawsInput): TawsOutput {
    void dt
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
    // caution when sink exceeds ~2.5×AGL fpm below 2500; warning ~4×AGL). ----
    const sink = -inp.vsFpm
    if (inp.aglFt < 2500 && sink > 1000) {
      if (sink > Math.max(1.6 * inp.aglFt, 1600)) consider('WARNING', 'PULL UP')
      else if (sink > Math.max(0.9 * inp.aglFt, 1200)) consider('CAUTION', 'SINK RATE')
    }

    // ---- Forward-looking terrain (and classic mode 2 closure) ----
    if (!inp.nearRunwayFinal) {
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
    if (!inp.nearRunwayFinal && inp.aglFt < 245 && inp.gsKt > 60 && inp.flapsDeg < 10) {
      consider('CAUTION', 'TOO LOW, FLAPS')
    }

    // ---- Mode 5: below the glideslope on approach ----
    if (inp.nearRunwayFinal && inp.gsDeviation !== null && inp.gsDeviation < -0.35 && inp.aglFt < 1000 && inp.aglFt > 150) {
      consider('CAUTION', 'GLIDESLOPE')
    }

    // ---- Mode 6: callouts + bank angle ----
    if (Math.abs(inp.rollDeg) > 45) consider('CAUTION', 'BANK ANGLE')
    if (!this.said500 && inp.aglFt <= 500 && inp.vsFpm < 0) {
      this.said500 = true
      if (level === 'NONE') {
        level = 'CAUTION'
        aural = 'FIVE HUNDRED'
      }
    }
    if (inp.aglFt > 900) this.said500 = false

    const newAural = aural !== undefined && aural !== this.lastAural
    this.lastAural = aural
    return { level, aural, newAural }
  }
}
