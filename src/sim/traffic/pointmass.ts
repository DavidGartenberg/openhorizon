/**
 * AI traffic point-mass (§13, Phase 6d): lat/lon/alt/speed/heading with
 * standard-rate turn, acceleration, and climb-rate limits — honest simple
 * performance, not teleporting markers. Pure module.
 */

export interface TrafficLeg {
  lat: number
  lon: number
  altFt: number
  gsKt: number
  /** Arrival radius override, m (default 250 — pattern-leg coarse; taxi
   *  legs need precision or "vacating" stops on the pavement, 14e). */
  arriveM?: number
}

const TURN_RATE_DEG_S = 3
const ACCEL_KT_S = 3
const CLIMB_FPM = 800
const DESCEND_FPM = 700
const ARRIVE_M = 250

export class TrafficPlane {
  lat: number
  lon: number
  altFt: number
  gsKt: number
  headingDeg: number
  private legs: TrafficLeg[] = []
  private idx = 0

  constructor(init: { lat: number; lon: number; altFt: number; gsKt: number; headingDeg: number }) {
    this.lat = init.lat
    this.lon = init.lon
    this.altFt = init.altFt
    this.gsKt = init.gsKt
    this.headingDeg = init.headingDeg
  }

  setLegs(legs: TrafficLeg[]): void {
    this.legs = legs
    this.idx = 0
  }

  currentLeg(): TrafficLeg | null {
    return this.legs[this.idx] ?? null
  }

  get legIndex(): number {
    return this.idx
  }

  step(dt: number): void {
    const leg = this.currentLeg()
    if (!leg) return
    const mLat = 111_320
    const mLon = mLat * Math.cos((this.lat * Math.PI) / 180)
    const dn = (leg.lat - this.lat) * mLat
    const de = (leg.lon - this.lon) * mLon
    const dist = Math.hypot(dn, de)
    if (dist < (leg.arriveM ?? ARRIVE_M)) {
      this.idx++
      return
    }
    const bearing = ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360
    const turn = ((bearing - this.headingDeg + 540) % 360) - 180
    const maxTurn = TURN_RATE_DEG_S * dt
    this.headingDeg = (this.headingDeg + Math.max(-maxTurn, Math.min(maxTurn, turn)) + 360) % 360

    const dv = Math.max(-ACCEL_KT_S * dt, Math.min(ACCEL_KT_S * dt, leg.gsKt - this.gsKt))
    this.gsKt = Math.max(this.gsKt + dv, 0)

    const dAlt = leg.altFt - this.altFt
    const maxUp = (CLIMB_FPM / 60) * dt
    const maxDown = (DESCEND_FPM / 60) * dt
    this.altFt += Math.max(-maxDown, Math.min(maxUp, dAlt))

    const stepM = this.gsKt * 0.514444 * dt
    const hRad = (this.headingDeg * Math.PI) / 180
    this.lat += (Math.cos(hRad) * stepM) / mLat
    this.lon += (Math.sin(hRad) * stepM) / mLon
  }
}
