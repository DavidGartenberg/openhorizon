/**
 * The aircraft (§5): 6-DOF rigid body integrating aero + propulsion + gear +
 * gravity at the fixed timestep. Body axes x fwd / y right / z down; world is
 * local flat NED for Phase 1 (geodetic truth state arrives with Phase 2).
 * Zero heap allocation in step() — all scratch preallocated.
 */
import { C172S } from './aircraft/c172s'
import type { AircraftParams } from './aircraft/params'
import { computeAero, makeAeroOutput, type AeroInput } from './aero'
import { stepPropulsion, makePropulsionState, type PropulsionState } from './propulsion'
import { makeTurbofanState, stepTurbofan, windmillDragN, type TurbofanState } from './turbofan'
import { computeGear, makeGearOutput, type GearInput } from './gear'
import { isa, casFromTas, kiasFromKcas, G, KT, FT, R_AIR, type AirState } from './atmosphere'
import {
  v3, q4, v3set, v3copy, v3cross, qrotate, qrotateInv, qintegrate, qfromEuler,
  qtoEuler, clamp, type Euler,
} from '../math/vec'

export interface Controls {
  /** Stick/yoke: +1 = full aft (nose up), -1 = full forward. */
  pitch: number
  /** +1 = full right roll. */
  roll: number
  /** +1 = right pedal. */
  yaw: number
  throttle: number // [0, 1]
  mixture: number // [0, 1]
  flapsIndex: number // 0..3 → 0/10/20/30°
  brakeLeft: number
  brakeRight: number
  /** Elevator trim, [-1, 1] → ±trimMaxRad. */
  trim: number
}

export interface FlightData {
  kias: number
  kcas: number
  ktas: number
  groundSpeedKt: number
  /** Ground-track direction, deg true; equals heading below ~3 kt GS. */
  trackDeg: number
  altitudeFt: number
  aglFt: number
  verticalSpeedFpm: number
  headingDeg: number
  pitchDeg: number
  rollDeg: number
  alphaDeg: number
  betaDeg: number
  rpm: number
  fuelFlowGph: number
  loadFactorG: number
  stallFraction: number
  onGround: boolean
  flapsDeg: number
  shaftPowerW: number
  thrustN: number
  /** Jet N1 % (0 for piston aircraft). */
  n1Pct: number
  /** Landing gear position, 1 = down/locked (fixed gear is always 1). */
  gearPos: number
}

export class Aircraft {
  /** Which airplane this body is (Phase 10a fleet): all physics modules read
   *  through these params. Defaults to the C172S — every existing caller and
   *  test constructs `new Aircraft()` and gets bit-identical behavior. */
  readonly P: AircraftParams

  // ---- state ----
  readonly posNed = v3() // m, z down (altitude = -z)
  readonly velBody = v3() // u, v, w m/s
  readonly quat = q4() // body→NED
  readonly rates = v3() // p, q, r rad/s
  readonly prop: PropulsionState = makePropulsionState()
  fuelKg: number
  payloadKg = 250 // pilot + pax + bags (W&B UI in Phase 8)
  flapsDeg = 0

  /** Turbofan state when P.jet is present, else null (piston). */
  readonly jetState: TurbofanState | null

  /** Gear lever state (systems-layer field like engineRunning, NOT a
   *  Controls axis — the AP/override paths must never retract the gear
   *  by accident). Fixed-gear aircraft ignore it. */
  gearDownCommanded = true
  /** Actual gear position 0..1 (1 = down/locked). Fixed gear pins at 1. */
  gearPos = 1
  /** Speedbrake lever [0,1] (spoilers param present); actuator below. */
  spoilerCmd = 0
  spoilerPos = 0
  /** Speedbrake ARM: on touchdown the ground spoilers auto-deploy. */
  spoilerArmed = false
  /** Reverse thrust: commanded by the pilot, deploy INTERLOCKED to
   *  weight-on-wheels (real airplane behavior). */
  reverseCmd = false
  reversePos = 0

  constructor(params: AircraftParams = C172S) {
    this.P = params
    this.fuelKg = params.fuelCapacityKg
    this.jetState = params.jet ? makeTurbofanState(params.jet) : null
  }

  readonly controls: Controls = {
    pitch: 0, roll: 0, yaw: 0, throttle: 0, mixture: 1,
    flapsIndex: 0, brakeLeft: 0, brakeRight: 0, trim: 0,
  }

  /** Extra wind in NED (from WindModel), applied as air-mass motion. */
  readonly windNed = v3()

  /** Terrain elevation (m MSL) at frame-local NED (north, east); Phase 2+. */
  groundElevAt: ((n: number, e: number) => number) | null = null

  /** Live-weather ISA temperature offset, °C (Phase 5 §11): shifts air
   *  density (hot day → thinner air → longer takeoff, weaker climb) while
   *  leaving pressure untouched — the dominant density-altitude term. 0 =
   *  ISA, which keeps the POH validation suite exactly as tuned. */
  isaTempOffsetC = 0

  /** Systems layer (Phase 3): whether the engine is actually running. Phase
   *  1/2 always ran the engine, so this defaults to true — callers that
   *  never touch systems (existing tests, current main.ts) see identical
   *  behavior. `src/sim/systems/engine-start.ts` drives this once wired in
   *  by the caller, making "stopped" (cold-and-dark, fuel-starved, shut
   *  down) a real reachable state: false here means no fuel is available
   *  to the engine this step, same mechanism as running the tank dry. */
  engineRunning = true

  /** Intake power multiplier from the carb-ice model (Phase 11b), set by
   *  the systems layer each frame. 1 (default) = clear venturi — injected
   *  engines and all existing callers see identical behavior. */
  intakePowerFactor = 1

  /** groundElevAt with a finite guard: a flaky terrain sample (NaN tile
   *  decode) must never reach aero (AGL/ground effect) or gear math —
   *  fall back to sea level, which is what a missing tile really means. */
  private safeGroundElev(n: number, e: number): number {
    const h = this.groundElevAt?.(n, e) ?? 0
    return Number.isFinite(h) ? h : 0
  }

  readonly data: FlightData = {
    kias: 0, kcas: 0, ktas: 0, groundSpeedKt: 0, trackDeg: 0, altitudeFt: 0, aglFt: 0,
    verticalSpeedFpm: 0, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
    alphaDeg: 0, betaDeg: 0, rpm: 0, fuelFlowGph: 0, loadFactorG: 1,
    stallFraction: 0, onGround: false, flapsDeg: 0, shaftPowerW: 0, thrustN: 0,
    n1Pct: 0, gearPos: 1,
  }

  // ---- scratch (no allocation in step) ----
  private readonly air: AirState = isa(0)
  private readonly velNed = v3()
  private readonly windBody = v3()
  private readonly vAirBody = v3()
  private readonly force = v3()
  private readonly moment = v3()
  private readonly gravBody = v3()
  private readonly coriolis = v3()
  private readonly euler: Euler = { yaw: 0, pitch: 0, roll: 0 }
  private readonly aeroOut = makeAeroOutput()
  private readonly gearOut = makeGearOutput()
  private readonly gearIn: GearInput = {
    posNed: this.posNed, velNed: this.velNed, quat: this.quat, rates: this.rates,
    rudder: 0, brakeLeft: 0, brakeRight: 0, groundZ: 0,
    groundZAt: (n, e) => -this.safeGroundElev(n, e),
  }
  private readonly aeroIn: AeroInput = {
    rho: 1.225, vAir: 0, alpha: 0, beta: 0, alphaDot: 0, p: 0, q: 0, r: 0,
    elevatorRad: 0, aileronRad: 0, rudderRad: 0, flapsDeg: 0,
    thrustN: 0, propTorqueNm: 0, heightAglM: 0,
  }
  private alphaPrev = 0
  private alphaDotFilt = 0

  get massKg(): number {
    return this.P.emptyMassKg + this.fuelKg + this.payloadKg
  }

  /** Place the aircraft on the ground at rest, heading ψ (rad). A tricycle
   *  sits at the tuned C172 attitude (bit-exact legacy path); a taildragger
   *  rests three-point at the pitch where mains and tailwheel touch
   *  together: tanθ = (z_main − z_tail)/(x_main − x_tail) in body frame. */
  spawnOnGround(north: number, east: number, headingRad: number, groundElevM = 0): void {
    const tail = this.P.gear.tail
    let pitch = 0.03
    let cgHeightM = this.P.gear.mainL.z - 0.07
    if (tail) {
      const main = this.P.gear.mainL
      pitch = Math.atan2(main.z - tail.z, main.x - tail.x)
      cgHeightM = main.z * Math.cos(pitch) - main.x * Math.sin(pitch) - 0.05
    }
    qfromEuler(this.quat, headingRad, pitch, 0)
    v3set(this.posNed, north, east, -(groundElevM + cgHeightM))
    v3set(this.velBody, 0, 0, 0)
    v3set(this.rates, 0, 0, 0)
    this.prop.omegaRadS = (700 * Math.PI) / 30
  }

  /** Set on structural-impact or numeric blowup; freezes physics until reset. */
  crashed = false

  step(dt: number): void {
    if (this.crashed) return
    const c = this.controls
    const m = this.massKg
    const altM = -this.posNed.z
    isa(altM, this.air)
    if (this.isaTempOffsetC !== 0) {
      this.air.temperatureK += this.isaTempOffsetC
      this.air.densityKgM3 = this.air.pressurePa / (R_AIR * this.air.temperatureK)
    }
    const rho = this.air.densityKgM3

    // Flap actuator. Detent count is per-aircraft (Cub has one, 737 six).
    const flapTarget = this.P.flapDetentsDeg[clamp(c.flapsIndex, 0, this.P.flapDetentsDeg.length - 1)]!
    const dFlap = clamp(flapTarget - this.flapsDeg, -this.P.flapRateDegS * dt, this.P.flapRateDegS * dt)
    this.flapsDeg += dFlap

    // Air-relative velocity in body frame.
    qrotateInv(this.windBody, this.quat, this.windNed)
    v3set(
      this.vAirBody,
      this.velBody.x - this.windBody.x,
      this.velBody.y - this.windBody.y,
      this.velBody.z - this.windBody.z,
    )
    const vAir = Math.max(Math.hypot(this.vAirBody.x, this.vAirBody.y, this.vAirBody.z), 0.001)
    const alpha = Math.atan2(this.vAirBody.z, Math.max(this.vAirBody.x, 0.5))
    const beta = Math.asin(clamp(this.vAirBody.y / vAir, -1, 1))

    // Filtered alpha-dot (downwash lag terms).
    const alphaDotRaw = (alpha - this.alphaPrev) / dt
    this.alphaDotFilt += clamp(alphaDotRaw - this.alphaDotFilt, -50 * dt, 50 * dt)
    this.alphaPrev = alpha

    // ---- gear transit (Phase 11e; fixed gear pins at 1) ----
    if (this.P.spoilers) {
      // ARM → auto-deploy on touchdown (ground spoilers).
      if (this.spoilerArmed && this.data.onGround) { this.spoilerCmd = 1; this.spoilerArmed = false }
      const sRate = this.P.spoilers.ratePerS * dt
      this.spoilerPos = clamp(this.spoilerPos + clamp(this.spoilerCmd - this.spoilerPos, -sRate, sRate), 0, 1)
    }
    if (this.P.reversers) {
      const tgt = this.reverseCmd && this.data.onGround ? 1 : 0
      const rRate = dt / this.P.reversers.transitS
      this.reversePos = clamp(this.reversePos + clamp(tgt - this.reversePos, -rRate, rRate), 0, 1)
    }
    if (this.P.gearRetractable) {
      const rate = dt / this.P.gearRetractable.transitS
      this.gearPos = clamp(this.gearPos + (this.gearDownCommanded ? rate : -rate), 0, 1)
    }

    // ---- propulsion ----
    // Params passed EXPLICITLY here and below: the modules' defaulted
    // C172S args exist for external callers/tests — if the 6-DOF relied on
    // the default, every fleet member would silently fly a C172 (§1).
    let mach = 0
    if (this.P.jet && this.jetState) {
      // Jet path: turbofan drives the shared `prop` output struct so the
      // force assembly / fuel / data plumbing below is powerplant-agnostic.
      mach = vAir / this.air.speedOfSoundMs
      const running = this.fuelKg > 0.5 && this.engineRunning
      stepTurbofan(this.jetState, dt, c.throttle, rho, mach, running, this.P.jet)
      this.prop.thrustN = running ? this.jetState.thrustN : -windmillDragN(rho, vAir, this.P.jet)
      // Reversers: cascade redirect — effective thrust swings negative as
      // the sleeves translate (weight-on-wheels interlocked upstream).
      if (this.P.reversers && this.reversePos > 0) {
        this.prop.thrustN *= 1 - this.reversePos * (1 + this.P.reversers.effectiveness)
      }
      this.prop.torqueNm = 0
      this.prop.fuelFlowKgS = this.jetState.fuelFlowKgS
      this.prop.shaftPowerW = Math.max(this.jetState.thrustN * vAir, 0)
      this.prop.rpm = 0
      this.prop.omegaRadS = 0
    } else {
      stepPropulsion(
        this.prop, dt, c.throttle, c.mixture, rho,
        Math.max(this.vAirBody.x, 0), this.fuelKg > 0.5 && this.engineRunning,
        this.P, this.intakePowerFactor,
      )
    }
    this.fuelKg = Math.max(this.fuelKg - this.prop.fuelFlowKgS * dt, 0)

    // ---- aero ----
    const ai = this.aeroIn
    ai.rho = rho
    ai.vAir = vAir
    ai.alpha = alpha
    ai.beta = beta
    ai.alphaDot = this.alphaDotFilt
    ai.p = this.rates.x
    ai.q = this.rates.y
    ai.r = this.rates.z
    // Trim-tab aircraft: tab + elevator share the surface — total clamps to
    // elevator travel (C172, bit-exact). Trimmable-stabilizer aircraft: the
    // stab is its own surface; its authority adds beyond elevator stops.
    ai.elevatorRad = this.P.trimIsStabilizer
      ? clamp(-c.pitch * this.P.elevatorMaxRad, -this.P.elevatorMaxRad, this.P.elevatorMaxRad) - c.trim * this.P.trimMaxRad
      : clamp(-c.pitch * this.P.elevatorMaxRad - c.trim * this.P.trimMaxRad, -this.P.elevatorMaxRad, this.P.elevatorMaxRad)
    ai.aileronRad = c.roll * this.P.aileronMaxRad
    // Convention bridge: +input = right pedal = nose right. The aero
    // derivatives use Roskam's +δr = trailing-edge-left (nose left), so the
    // aerodynamic rudder angle is the negative of the pilot input.
    ai.rudderRad = -c.yaw * this.P.rudderMaxRad
    ai.flapsDeg = this.flapsDeg
    ai.thrustN = this.prop.thrustN
    ai.propTorqueNm = this.prop.torqueNm
    ai.mach = mach
    ai.extraCd = (this.P.gearRetractable ? this.P.gearRetractable.dCdExtended * this.gearPos : 0) +
      (this.P.spoilers ? this.P.spoilers.dCd * this.spoilerPos : 0)
    ai.extraClDump = this.P.spoilers ? this.P.spoilers.dCl * this.spoilerPos : 0
    const groundElev = this.safeGroundElev(this.posNed.x, this.posNed.y)
    ai.heightAglM = altM - groundElev
    this.data.aglFt = ai.heightAglM / FT
    computeAero(ai, this.aeroOut, this.P)

    v3copy(this.force, this.aeroOut.force)
    this.force.x += this.prop.thrustN
    v3copy(this.moment, this.aeroOut.moment)

    // ---- gear ----
    qrotate(this.velNed, this.quat, this.velBody)
    if (this.gearPos > 0.95) {
      this.gearIn.rudder = c.yaw
      this.gearIn.brakeLeft = c.brakeLeft
      this.gearIn.brakeRight = c.brakeRight
      computeGear(this.gearIn, this.gearOut, this.P)
      this.force.x += this.gearOut.force.x
      this.force.y += this.gearOut.force.y
      this.force.z += this.gearOut.force.z
      this.moment.x += this.gearOut.moment.x
      this.moment.y += this.gearOut.moment.y
      this.moment.z += this.gearOut.moment.z
    } else {
      // Gear not down: no wheel forces. Surface contact gear-up is a crash
      // (no belly-slide model — honest simplification, recorded).
      this.gearOut.onGround = false
      this.gearOut.maxCompressionM = 0
      if (ai.heightAglM < 0.3) this.crashed = true
    }

    // ---- gravity ----
    qrotateInv(this.gravBody, this.quat, v3set(this.windBody, 0, 0, m * G))
    // (windBody reused as scratch — safe, no longer needed this step)

    // ---- integrate (semi-implicit) ----
    // Load factor before adding gravity: nz from non-gravitational forces.
    this.data.loadFactorG = -(this.force.z / m) / G

    v3cross(this.coriolis, this.rates, this.velBody)
    this.velBody.x += ((this.force.x + this.gravBody.x) / m - this.coriolis.x) * dt
    this.velBody.y += ((this.force.y + this.gravBody.y) / m - this.coriolis.y) * dt
    this.velBody.z += ((this.force.z + this.gravBody.z) / m - this.coriolis.z) * dt

    const massRatio = m / this.P.mtowKg
    const ixx = this.P.inertiaMtow.ixx * massRatio
    const iyy = this.P.inertiaMtow.iyy * massRatio
    const izz = this.P.inertiaMtow.izz * massRatio
    const { x: p, y: q, z: r } = this.rates
    this.rates.x += ((this.moment.x - (izz - iyy) * q * r) / ixx) * dt
    this.rates.y += ((this.moment.y - (ixx - izz) * p * r) / iyy) * dt
    this.rates.z += ((this.moment.z - (iyy - ixx) * p * q) / izz) * dt

    qintegrate(this.quat, this.rates, dt)
    qrotate(this.velNed, this.quat, this.velBody)
    this.posNed.x += this.velNed.x * dt
    this.posNed.y += this.velNed.y * dt
    this.posNed.z += this.velNed.z * dt

    // Crash guard: structural impact (deep gear strike / absurd ground
    // speed) or numeric blowup freezes the sim honestly instead of exploding.
    const finite =
      isFinite(this.posNed.x + this.posNed.y + this.posNed.z) &&
      isFinite(this.velBody.x + this.velBody.y + this.velBody.z) &&
      isFinite(this.rates.x + this.rates.y + this.rates.z) &&
      isFinite(this.quat.w + this.quat.x + this.quat.y + this.quat.z)
    // 105 m/s ≈ 204 kt GS on wheels: past every fleet tire limit (B737
    // Vtire 195 kt) yet clear of every legitimate rotation/touchdown.
    // The old C172-era 75 m/s froze 737 takeoffs mid-roll at ~140 KIAS.
    const impact =
      this.gearOut.maxCompressionM > 0.45 ||
      (this.gearOut.onGround && Math.hypot(this.velNed.x, this.velNed.y, this.velNed.z) > 105)
    if (!finite || impact) {
      this.crashed = true
      v3set(this.velBody, 0, 0, 0)
      v3set(this.rates, 0, 0, 0)
      if (!finite) {
        qfromEuler(this.quat, 0, 0, 0)
        v3set(this.posNed, 0, 0, this.posNed.z || 0)
      }
      return
    }

    this.updateFlightData(vAir, alpha, beta, rho)
  }

  private updateFlightData(vAir: number, alpha: number, beta: number, rho: number): void {
    const d = this.data
    const kcas = casFromTas(vAir, rho) / KT
    d.ktas = vAir / KT
    d.kcas = kcas
    // Per-aircraft position error; no published table honestly means IAS=CAS
    // (never borrow another type's pitot — §1).
    d.kias = Math.max(this.P.pitotCal ? kiasFromKcas(kcas, this.flapsDeg, this.P.pitotCal) : kcas, 0)
    d.groundSpeedKt = Math.hypot(this.velNed.x, this.velNed.y) / KT
    d.trackDeg =
      d.groundSpeedKt > 3
        ? ((Math.atan2(this.velNed.y, this.velNed.x) * 180) / Math.PI + 360) % 360
        : d.headingDeg
    d.altitudeFt = -this.posNed.z / FT
    d.verticalSpeedFpm = (-this.velNed.z / FT) * 60
    qtoEuler(this.euler, this.quat)
    d.headingDeg = ((this.euler.yaw * 180) / Math.PI + 360) % 360
    d.pitchDeg = (this.euler.pitch * 180) / Math.PI
    d.rollDeg = (this.euler.roll * 180) / Math.PI
    d.alphaDeg = (alpha * 180) / Math.PI
    d.betaDeg = (beta * 180) / Math.PI
    d.rpm = this.prop.rpm
    d.fuelFlowGph = (this.prop.fuelFlowKgS / 2.72155) * 3600 // kg/s → USG/hr avgas
    d.n1Pct = this.jetState ? this.jetState.n1Pct : 0
    d.gearPos = this.gearPos
    d.stallFraction = this.aeroOut.stallFraction
    d.onGround = this.gearOut.onGround
    d.flapsDeg = this.flapsDeg
    d.shaftPowerW = this.prop.shaftPowerW
    d.thrustN = this.prop.thrustN
  }

  /** Set full state for a trimmed flight condition (used by trim/tests). */
  applyTrimState(
    tasMs: number, alphaRad: number, altM: number, headingRad: number,
    gammaRad: number, elevatorTrimRad: number, throttle: number, rpm: number,
  ): void {
    qfromEuler(this.quat, headingRad, alphaRad + gammaRad, 0)
    v3set(this.velBody, tasMs * Math.cos(alphaRad), 0, tasMs * Math.sin(alphaRad))
    v3set(this.posNed, 0, 0, -altM)
    v3set(this.rates, 0, 0, 0)
    this.controls.throttle = throttle
    this.controls.trim = clamp(-elevatorTrimRad / this.P.trimMaxRad, -1, 1)
    this.controls.pitch = clamp(
      -(elevatorTrimRad + this.controls.trim * this.P.trimMaxRad) / this.P.elevatorMaxRad, -1, 1,
    )
    // For jets the trim solver's `rpm` slot carries N1 % — seed the spool.
    if (this.jetState) this.jetState.n1Pct = rpm
    this.prop.omegaRadS = (rpm * Math.PI) / 30
    this.alphaPrev = alphaRad
    // Trim is an AIRMASS condition: the requested TAS is air-relative, so
    // ground velocity = air velocity + wind. Without this, spawning into a
    // 10 kt tailwind put the aircraft 10 kt slow through the air and it
    // mushed on AP engage (found by the Phase-7 KPAO acceptance run).
    if (this.windNed.x !== 0 || this.windNed.y !== 0 || this.windNed.z !== 0) {
      qrotateInv(this.windBody, this.quat, this.windNed)
      this.velBody.x += this.windBody.x
      this.velBody.y += this.windBody.y
      this.velBody.z += this.windBody.z
    }
    // Stamp heading/track into derived data immediately — consumers (AP
    // track steering) otherwise see one stale tick of trackDeg=0 after a
    // teleport-spawn, commanding a full-deflection transient.
    this.data.headingDeg = ((headingRad * 180) / Math.PI + 360) % 360
    this.data.trackDeg = this.data.headingDeg
    this.alphaDotFilt = 0
  }
}
