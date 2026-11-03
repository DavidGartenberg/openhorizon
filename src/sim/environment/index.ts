/**
 * Environment / physics mods, stepped with the flight model.
 *
 * Adds on top of the steady wind + turbulence (WindModel):
 *   - thermals (convective lift, sun-driven) and ridge lift (wind over slopes)
 *   - microburst windshear (on command) with a reactive F-factor alert
 *   - wake turbulence from other traffic (vertical gusts + violent roll)
 *   - airframe icing (in cloud or freezing precipitation below 0 °C)
 *   - runway contamination (wet / snow / slush / ice, hydroplaning)
 *   - structural limits (overstress, wing failure beyond ultimate load)
 * Each writes into the aircraft's neutral `env` hooks and/or the air-mass
 * wind. With calm, clear, dry conditions and no traffic, all of it is inert.
 */
import type { V3 } from '../../math/vec'
import type { AircraftParams } from '../aircraft/params'
import { ThermalField, convectiveStrength, ridgeLift } from './thermals'
import { thermalCumulus, type CumulusCloud } from './cumulus'
import { Microburst, WindshearDetector } from './microburst'
import { WakeField } from './wake'
import { runwayConditionFromWeather, surfaceFriction, tirePressurePsiFor, type RunwayCondition } from './runway-surface'
import { AirframeIce, precipitationFromWeather } from '../systems/airframe-ice'
import { StructureMonitor } from '../systems/structure'

export interface EnvironmentState {
  timeS: number
  dt: number
  /** Frame-local north/east (m), altitude MSL (m), height above ground (m). */
  n: number
  e: number
  altM: number
  aglM: number
  tasMs: number
  headingRad: number
  trackRad: number
  groundSpeedMs: number
  onGround: boolean
  loadFactorG: number
  flapsDeg: number
  rollRate: number
  oatC: number
  /** Visible moisture 0..1. */
  inCloud: number
  /** METAR present-weather groups in effect. */
  weather: readonly string[]
  /** Surface temperature (°C) for runway state; undefined = unknown. */
  surfaceTempC?: number
  sunElevDeg: number
  cloudCover: number
  overWater: boolean
  groundElevAt: ((n: number, e: number) => number) | null
  /** Steady wind (m/s north/east) — thermals and wakes drift with it. */
  windN: number
  windE: number
  /** Turbulence roll gust (rad/s) from WindModel, combined with wake roll. */
  turbulenceRollGust: number
}

export interface EnvironmentHooks {
  iceCdInc: number
  clMaxFactor: number
  rollGustRate: number
  brakeMuScale: number
  latMuScale: number
  rollingScale: number
  wingFailure: -1 | 0 | 1
}

export type EnvironmentEventKind = 'windshear' | 'overstress' | 'failure' | 'icing' | 'hydroplaning'
export interface EnvironmentEvent { kind: EnvironmentEventKind; text: string }

export interface EnvironmentToggles {
  thermals: boolean
  ridge: boolean
  wake: boolean
  icing: boolean
  contamination: boolean
  structure: boolean
  windshear: boolean
}

export class Environment {
  readonly thermals = new ThermalField()
  readonly wake = new WakeField()
  readonly ice = new AirframeIce()
  readonly shear = new WindshearDetector()
  readonly structure: StructureMonitor
  microbursts: Microburst[] = []
  toggles: EnvironmentToggles = { thermals: true, ridge: true, wake: true, icing: true, contamination: true, structure: true, windshear: true }
  readonly status = {
    convection: 0,
    updraftMs: 0,
    ridgeMs: 0,
    microburstDownMs: 0,
    wakeRollRate: 0,
    wakeVerticalMs: 0,
    iceMm: 0,
    /** Supercooled water present: an unprotected airframe would be icing. */
    icingConditions: false,
    runway: 'dry' as RunwayCondition,
    hydroplaning: false,
    windshearF: 0,
    windshear: false,
  }
  private readonly tirePsi: number
  /** Ground-fixed origin of the thermal lattice in the current frame. */
  private originN = 0
  private originE = 0
  private iceReported = 0
  private wasHydroplaning = false
  private readonly mb = { x: 0, y: 0, z: 0 }

  /** Crew anti-ice selection (jets/turboprops): AUTO and ON protect the
   *  airframe, OFF leaves it to ice like an unprotected one. */
  antiIce: 'auto' | 'on' | 'off' = 'auto'

  /** Wing/engine anti-ice is protecting the airframe right now. */
  get protectedAirframe(): boolean {
    return this.iceProtectionFitted && this.antiIce !== 'off'
  }

  constructor(readonly P: AircraftParams, readonly iceProtectionFitted = !!P.jet || P.mtowKg > 5_700, readonly reactiveWindshear = !!P.jet) {
    this.structure = new StructureMonitor(P)
    this.tirePsi = tirePressurePsiFor(P.mtowKg)
  }

  /** Spawn a microburst `distanceM` ahead on the current track. */
  spawnMicroburstAhead(n: number, e: number, trackRad: number, timeS: number, distanceM = 3000, peakDowndraftMs = 12): Microburst {
    const m = new Microburst({ n: n + Math.cos(trackRad) * distanceM, e: e + Math.sin(trackRad) * distanceM, startS: timeS - 150, peakDowndraftMs })
    this.microbursts.push(m)
    return m
  }

  /** Cumulus capping today's thermals around a frame-local point (positions
   *  returned in the frame-local NED frame). */
  cumulusAround(n: number, e: number, timeS: number, dewpointSpreadC: number, windN = 0, windE = 0): CumulusCloud[] {
    if (!this.toggles.thermals) return []
    return thermalCumulus(this.thermals, n + this.originN, e + this.originE, timeS, this.status.convection, dewpointSpreadC, windN, windE)
      .map((c) => ({ ...c, n: c.n - this.originN, e: c.e - this.originE }))
  }

  /** Floating-origin rebase: the frame moved by (dn, de) metres (the new
   *  anchor is at the old (dn, de)). Wakes and microbursts move with the
   *  air; the thermal lattice stays fixed to the ground. */
  onRebase(dn: number, de: number): void {
    this.originN += dn
    this.originE += de
    this.wake.shift(-dn, -de)
    this.microbursts = this.microbursts.map((m) => m.shifted(-dn, -de))
  }

  /** Clear accumulated state (new flight / reset). */
  reset(): void {
    this.ice.reset()
    this.structure.reset()
    this.wake.clear()
    this.microbursts = []
    this.iceReported = 0
    this.wasHydroplaning = false
  }

  /**
   * Advance one step: adds the environment winds into `windNed` (NED m/s,
   * on top of WindModel's output) and writes the aircraft hooks.
   */
  step(s: EnvironmentState, windNed: V3, hooks: EnvironmentHooks): EnvironmentEvent[] {
    const events: EnvironmentEvent[] = []
    const T = this.toggles
    // ---- convection + ridge lift (vertical air motion, up +) ----
    let up = 0
    const strength = T.thermals ? convectiveStrength({ sunElevDeg: s.sunElevDeg, cloudCover: s.cloudCover, surfaceWindMs: Math.hypot(s.windN, s.windE), overWater: s.overWater }) : 0
    this.status.convection = strength
    const thermal = strength > 0 && !s.onGround ? this.thermals.updraftAt(s.n + this.originN, s.e + this.originE, s.aglM, s.timeS, strength, s.windN, s.windE) : 0
    this.status.updraftMs = thermal
    up += thermal
    let ridge = 0
    if (T.ridge && s.groundElevAt && !s.onGround && s.aglM < 1500 && (s.windN !== 0 || s.windE !== 0)) {
      const d = 60
      const gN = (s.groundElevAt(s.n + d, s.e) - s.groundElevAt(s.n - d, s.e)) / (2 * d)
      const gE = (s.groundElevAt(s.n, s.e + d) - s.groundElevAt(s.n, s.e - d)) / (2 * d)
      if (Number.isFinite(gN) && Number.isFinite(gE)) ridge = ridgeLift(s.windN, s.windE, gN, gE, s.aglM)
    }
    this.status.ridgeMs = ridge
    up += ridge
    // ---- microbursts ----
    this.microbursts = this.microbursts.filter((m) => !m.isOver(s.timeS))
    let mbDown = 0
    for (const m of this.microbursts) {
      m.windAt(s.n, s.e, s.aglM, s.timeS, this.mb)
      windNed.x += this.mb.x
      windNed.y += this.mb.y
      windNed.z += this.mb.z
      mbDown += this.mb.z
    }
    this.status.microburstDownMs = mbDown
    // ---- wake vortices ----
    let wakeRoll = 0
    if (T.wake && this.wake.size > 0 && !s.onGround) {
      const wv = this.wake.verticalAt(s.n, s.e, s.altM, s.timeS, s.windN, s.windE)
      wakeRoll = this.wake.rollGustAt(s.n, s.e, s.altM, s.headingRad, this.P.spanM, s.timeS, s.windN, s.windE)
      up += wv
      this.status.wakeVerticalMs = wv
    } else {
      this.status.wakeVerticalMs = 0
    }
    this.status.wakeRollRate = wakeRoll
    this.wake.prune(s.timeS)
    windNed.z -= up // NED z is down
    hooks.rollGustRate = s.turbulenceRollGust + wakeRoll
    // ---- reactive windshear (jets) ----
    if (T.windshear && this.reactiveWindshear) {
      const began = this.shear.step(s.dt, windNed.x, windNed.y, windNed.z, s.trackRad, s.tasMs, !s.onGround && s.aglM > 15 && s.aglM < 450)
      this.status.windshearF = this.shear.f
      this.status.windshear = this.shear.active
      if (began) events.push({ kind: 'windshear', text: 'WINDSHEAR' })
    }
    // ---- airframe ice ----
    if (T.icing) {
      const precip = precipitationFromWeather(s.weather)
      this.status.icingConditions = s.oatC <= 0.5 && AirframeIce.lwc(s.inCloud, precip, s.oatC) > 0
      this.ice.step({ dt: s.dt, oatC: s.oatC, inCloud: s.inCloud, precip, tasMs: s.tasMs, protectedAirframe: this.protectedAirframe })
      hooks.iceCdInc = this.ice.cdIncrement
      hooks.clMaxFactor = this.ice.clMaxFactor
      const mm = this.ice.thicknessMm
      if (mm >= this.iceReported + 1 && mm >= 1) {
        this.iceReported = Math.floor(mm)
        events.push({ kind: 'icing', text: `AIRFRAME ICE ${mm.toFixed(0)} MM` })
      } else if (mm < 0.5) {
        this.iceReported = 0
      }
    } else {
      hooks.iceCdInc = 0
      hooks.clMaxFactor = 1
    }
    this.status.iceMm = this.ice.thicknessMm
    // ---- runway contamination ----
    if (T.contamination) {
      const cond = runwayConditionFromWeather(s.weather, s.surfaceTempC)
      const f = surfaceFriction(cond, s.onGround ? s.groundSpeedMs : 0, this.tirePsi)
      hooks.brakeMuScale = f.brakeMuScale
      hooks.latMuScale = f.latMuScale
      hooks.rollingScale = f.rollingScale
      this.status.runway = cond
      this.status.hydroplaning = f.hydroplaning
      if (f.hydroplaning && !this.wasHydroplaning) events.push({ kind: 'hydroplaning', text: 'HYDROPLANING' })
      this.wasHydroplaning = f.hydroplaning
    } else {
      hooks.brakeMuScale = 1
      hooks.latMuScale = 1
      hooks.rollingScale = 1
      this.status.runway = 'dry'
      this.status.hydroplaning = false
    }
    // ---- structure (wing loads: airborne only — gear contact, including a
    // spawn or teleport into the ground, is not a wing load) ----
    if (T.structure && !s.onGround) {
      const ev = this.structure.step(s.dt, s.loadFactorG, s.flapsDeg, s.rollRate)
      const lim = this.structure.limitsFor(s.flapsDeg)
      if (ev === 'overstress') events.push({ kind: 'overstress', text: `OVERSTRESS ${s.loadFactorG.toFixed(1)} G (LIMIT ${s.loadFactorG > 0 ? lim.pos.toFixed(1) : lim.neg.toFixed(1)})` })
      if (ev === 'failure') events.push({ kind: 'failure', text: `STRUCTURAL FAILURE — ${this.structure.wingFailure < 0 ? 'LEFT' : 'RIGHT'} WING` })
      hooks.wingFailure = this.structure.wingFailure
    }
    return events
  }
}
