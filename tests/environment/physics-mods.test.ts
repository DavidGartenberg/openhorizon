import { describe, expect, it } from 'vitest'
import { WindModel, drydenScales } from '../../src/sim/wind'
import { seededRandom, gaussian as gaussianFrom } from '../../src/sim/environment/rng'
import { ThermalField, convectiveStrength, thermalProfile, ridgeLift, boundaryLayerDepthM } from '../../src/sim/environment/thermals'
import { Microburst, WindshearDetector } from '../../src/sim/environment/microburst'
import { WakeField, wakeCirculation, wakeDecay } from '../../src/sim/environment/wake'
import { runwayConditionFromWeather, surfaceFriction, hydroplaningSpeedMs, tirePressurePsiFor } from '../../src/sim/environment/runway-surface'
import { AirframeIce, precipitationFromWeather, supercooledFraction } from '../../src/sim/systems/airframe-ice'
import { StructureMonitor, loadLimitsFor, structuralCategoryFor } from '../../src/sim/systems/structure'
import { Environment, type EnvironmentState } from '../../src/sim/environment'
import { Aircraft } from '../../src/sim/aircraft'
import { C172S } from '../../src/sim/aircraft/c172s'
import { B738 } from '../../src/sim/aircraft/b738'
import { rosterParams } from '../../src/sim/aircraft/roster'
import { trim } from '../../src/sim/trim'
import { computeAero, type AeroOutput } from '../../src/sim/aero'
import { v3 } from '../../src/math/vec'

const FT = 0.3048

describe('MIL-F-8785C Dryden turbulence', () => {
  it('uses the low-altitude scales below 1,000 ft and the 1,750 ft scales above 2,000 ft', () => {
    const lo = drydenScales(100 * FT, 10, 0)
    expect(lo.Lw).toBeCloseTo(100 * FT, 6)
    expect(lo.sw).toBeCloseTo(1, 6) // 0.1·W20
    expect(lo.su / lo.sw).toBeCloseTo(1 / (0.177 + 0.0823) ** 0.4, 4)
    const hi = drydenScales(5000 * FT, 10, 2)
    expect(hi.Lw).toBeCloseTo(1750 * FT, 6)
    expect(hi.sw).toBeCloseTo(3, 6) // moderate
    const mid = drydenScales(1500 * FT, 10, 2)
    expect(mid.Lw).toBeGreaterThan(lo.Lw)
    expect(mid.Lw).toBeLessThan(hi.Lw)
  })

  it('produces the specified RMS and correlation time (statistics over 2 h of flight)', () => {
    const w = new WindModel()
    w.rng = seededRandom(42)
    w.intensity = 2
    const V = 60, b = 11
    w.setFlightState(3000, V, b)
    const out = { x: 0, y: 0, z: 0 }
    const dt = 0.05
    let sum2 = 0, n = 0, lag = 0, prev = 0, roll2 = 0
    const L = 1750 * FT, lagSteps = Math.round(L / V / dt)
    const hist: number[] = []
    for (let i = 0; i < 144_000; i++) {
      w.step(dt, out)
      const z = out.z
      sum2 += z * z; n++
      roll2 += w.rollGustRate ** 2
      hist.push(z)
      if (hist.length > lagSteps) { lag += hist[hist.length - 1 - lagSteps]! * z; prev++ }
    }
    const rms = Math.sqrt(sum2 / n)
    expect(rms).toBeGreaterThan(3 * 0.85)
    expect(rms).toBeLessThan(3 * 1.15)
    // Autocorrelation at one time constant ≈ e^−1.
    expect(lag / prev / (sum2 / n)).toBeGreaterThan(0.25)
    expect(lag / prev / (sum2 / n)).toBeLessThan(0.5)
    // Roll gust RMS ≈ 2σδ/b with σδ = σw·√((1−e^(−b/L))/2).
    const expected = (2 * 3 * Math.sqrt((1 - Math.exp(-b / L)) / 2)) / b
    expect(Math.sqrt(roll2 / n)).toBeGreaterThan(expected * 0.8)
    expect(Math.sqrt(roll2 / n)).toBeLessThan(expected * 1.2)
  })

  it('has no vertical gusts or roll gusts on the ground, tapering in over the first 8 m', () => {
    const rmsAt = (agl: number, onGround: boolean): { w: number; p: number } => {
      const w = new WindModel()
      w.rng = seededRandom(7)
      w.intensity = 2
      w.setFlightState(agl, onGround ? 2 : 30, 11, onGround)
      const out = { x: 0, y: 0, z: 0 }
      let z2 = 0, p2 = 0
      for (let i = 0; i < 40_000; i++) { w.step(0.02, out); z2 += out.z ** 2; p2 += w.rollGustRate ** 2 }
      return { w: Math.sqrt(z2 / 40_000), p: Math.sqrt(p2 / 40_000) }
    }
    const ground = rmsAt(0, true)
    expect(ground.w).toBe(0)
    expect(ground.p).toBe(0)
    const low = rmsAt(4, false), high = rmsAt(16, false)
    expect(low.w).toBeGreaterThan(0)
    expect(low.w).toBeLessThan(high.w * 0.75)
  })

  it('is perfectly calm with no wind and no reported turbulence', () => {
    const w = new WindModel()
    w.setFlightState(300, 50, 11)
    const out = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 1000; i++) w.step(0.01, out)
    expect([out.x, out.y, out.z, w.rollGustRate]).toEqual([0, 0, 0, 0])
  })
})

describe('thermals and ridge lift', () => {
  const day = { sunElevDeg: 55, cloudCover: 0.2, surfaceWindMs: 4, overWater: false }
  it('convection follows the sun, dies at night, over water and under overcast', () => {
    expect(convectiveStrength(day)).toBeGreaterThan(0.6)
    expect(convectiveStrength({ ...day, sunElevDeg: -5 })).toBe(0)
    expect(convectiveStrength({ ...day, overWater: true })).toBe(0)
    expect(convectiveStrength({ ...day, cloudCover: 1 })).toBeLessThan(convectiveStrength(day) * 0.3)
  })

  it('has the mixed-layer profile: zero at the ground and inversion, peak ≈ ¼ up', () => {
    expect(thermalProfile(0)).toBe(0)
    expect(thermalProfile(0.95)).toBe(0)
    expect(thermalProfile(1 / 4.4)).toBeCloseTo(1, 3)
    expect(thermalProfile(0.1)).toBeLessThan(1)
  })

  it('places real, repeatable thermals with sink between them', () => {
    const f = new ThermalField(7)
    const s = convectiveStrength(day)
    const zi = boundaryLayerDepthM(s)
    let best = -Infinity, worst = Infinity, total = 0, samples = 0
    for (let n = 0; n < 12_000; n += 50) for (let e = 0; e < 12_000; e += 50) {
      const w = f.updraftAt(n, e, zi * 0.3, 600, s)
      best = Math.max(best, w); worst = Math.min(worst, w); total += w; samples++
    }
    expect(best).toBeGreaterThan(2) // a usable thermal somewhere in 12 km
    expect(worst).toBeLessThan(0) // sink exists
    expect(total / samples).toBeLessThan(best * 0.15) // mostly neutral-to-sink air
    expect(f.updraftAt(1234, 5678, 400, 600, s)).toBe(new ThermalField(7).updraftAt(1234, 5678, 400, 600, s))
  })

  it('leans thermals downwind with height', () => {
    const f = new ThermalField(7)
    const s = 0.9
    // Find a thermal core low down, then look for it higher up with a wind.
    let core = { n: 0, e: 0, w: -1 }
    for (let n = 0; n < 6000; n += 40) for (let e = 0; e < 6000; e += 40) {
      const w = f.updraftAt(n, e, 150, 600, s)
      if (w > core.w) core = { n, e, w }
    }
    const high = 1200, still = f.updraftAt(core.n, core.e, high, 600, s, 0, 0)
    const windy = f.updraftAt(core.n, core.e, high, 600, s, 0, 6)
    expect(windy).toBeLessThan(still) // the column has moved east
  })

  it('ridge lift rises on the windward slope, sinks in the lee, fades with height', () => {
    expect(ridgeLift(0, 10, 0, 0.3, 50)).toBeGreaterThan(2)
    expect(ridgeLift(0, 10, 0, -0.3, 50)).toBeLessThan(-2)
    expect(ridgeLift(0, 10, 0, 0.3, 800)).toBeLessThan(ridgeLift(0, 10, 0, 0.3, 50) * 0.2)
  })
})

describe('microburst windshear', () => {
  const mb = new Microburst({ n: 0, e: 0, startS: -300, radiusM: 1000, peakDowndraftMs: 12 })
  const w = { x: 0, y: 0, z: 0 }

  it('conserves mass (axisymmetric continuity holds to numerical precision)', () => {
    for (const [r, z] of [[300, 200], [800, 80], [1500, 400], [600, 900]] as const) {
      const h = 0.5
      const ur = (rr: number, zz: number): number => mb.windAt(rr, 0, zz, 0, w).x
      const wz = (rr: number, zz: number): number => -mb.windAt(rr, 0, zz, 0, w).z
      const div = ((r + h) * ur(r + h, z) - (r - h) * ur(r - h, z)) / (2 * h * r) + (wz(r, z + h) - wz(r, z - h)) / (2 * h)
      expect(Math.abs(div)).toBeLessThan(1e-4)
    }
  })

  it('has no flow through the ground, a core downdraft and an outflow below', () => {
    expect(Math.abs(mb.windAt(200, 0, 0, 0, w).z)).toBeLessThan(1e-9)
    expect(mb.windAt(0, 0, 400, 0, w).z).toBeGreaterThan(5) // strong downdraft (NED +)
    expect(mb.windAt(700, 0, 30, 0, w).x).toBeGreaterThan(5) // outward north
    expect(mb.windAt(-700, 0, 30, 0, w).x).toBeLessThan(-5) // outward south
    expect(new Microburst({ n: 0, e: 0, startS: 100 }).windAt(0, 0, 300, 50, w).z).toBe(0) // not yet born
  })

  it('severe low-altitude turbulence alone does not raise a windshear alert', () => {
    // MIL-F-8785C severe at 300 ft AGL (W20 = 45 kt): σu ≈ 3.3 m/s with
    // τ ≈ 3.4 s, σw ≈ 2.3 m/s with τ ≈ 1.2 s, at approach speed — ten minutes.
    const det = new WindshearDetector()
    const rnd = seededRandom(9)
    const V = 75, dt = 1 / 120
    let u = 0, w = 0, any = false
    for (let t = 0; t < 600; t += dt) {
      const au = Math.exp(-dt / 3.4), aw = Math.exp(-dt / 1.2)
      u = au * u + 3.3 * Math.sqrt(1 - au * au) * gaussianFrom(rnd)
      w = aw * w + 2.3 * Math.sqrt(1 - aw * aw) * gaussianFrom(rnd)
      if (det.step(dt, u, 0, w, 0, V, true)) any = true
    }
    expect(any).toBe(false)
  })

  it('a jet flying through it on approach gets a windshear alert; calm air does not', () => {
    const det = new WindshearDetector()
    const V = 75, alt = 250
    let alerted = false
    for (let t = 0; t < 60; t += 0.05) {
      const n = -2500 + V * t
      mb.windAt(n, 0, alt, 0, w)
      if (det.step(0.05, w.x, w.y, w.z, 0, V, true)) alerted = true
    }
    expect(alerted).toBe(true)
    const calm = new WindshearDetector()
    let any = false
    for (let t = 0; t < 60; t += 0.05) if (calm.step(0.05, 5, 3, 0, 0, V, true)) any = true
    expect(any).toBe(false)
  })
})

describe('wake turbulence', () => {
  it('a 737 sheds a realistic vortex circulation that decays over minutes', () => {
    const { gamma0, b0 } = wakeCirculation(70_000, 70, 35.8)
    expect(b0).toBeCloseTo((Math.PI * 35.8) / 4, 6)
    expect(gamma0).toBeGreaterThan(200)
    expect(gamma0).toBeLessThan(450)
    expect(wakeDecay(20)).toBe(1)
    expect(wakeDecay(100)).toBeCloseTo(Math.exp(-1), 6)
    expect(wakeDecay(300)).toBeLessThan(0.03)
  })

  it('downwash between the vortices, upwash outboard, sinking with age', () => {
    const f = new WakeField()
    // Generator flying north at 1,000 m.
    for (let t = 0; t <= 20; t++) f.push({ id: 'heavy', n: 70 * t, e: 0, altM: 1000, trackRad: 0, speedMs: 70, massKg: 70_000, spanM: 35.8 }, t)
    const tq = 25, n = 70 * 10 // a slice laid at t = 10 s
    const b0 = (Math.PI * 35.8) / 4
    // Sink after 15 s at Γ/(2πb0).
    const sink = (wakeCirculation(70_000, 70, 35.8).gamma0 / (2 * Math.PI * b0)) * 15
    expect(f.verticalAt(n, 0, 1000 - sink, tq)).toBeLessThan(-3) // between: down
    expect(f.verticalAt(n, b0, 1000 - sink, tq)).toBeGreaterThan(2) // outboard right: up
    expect(f.verticalAt(n, -b0, 1000 - sink, tq)).toBeGreaterThan(2) // outboard left: up
    expect(f.verticalAt(n, 0, 1000 - sink, tq, 0, 0, 'heavy')).toBe(0) // own wake excluded
  })

  it('straddling one vortex gives a light aircraft a violent roll', () => {
    const f = new WakeField()
    for (let t = 0; t <= 20; t++) f.push({ id: 'heavy', n: 70 * t, e: 0, altM: 1000, trackRad: 0, speedMs: 70, massKg: 70_000, spanM: 35.8 }, t)
    const b0 = (Math.PI * 35.8) / 4
    const sink = (wakeCirculation(70_000, 70, 35.8).gamma0 / (2 * Math.PI * b0)) * 15
    const p = f.rollGustAt(700, b0 / 2, 1000 - sink, 0, 11, 25)
    expect(Math.abs(p)).toBeGreaterThan(0.5) // > 30°/s, beyond a C172's roll authority
  })
})

describe('runway contamination', () => {
  it('reads the runway state from METAR weather and temperature', () => {
    expect(runwayConditionFromWeather([], 15)).toBe('dry')
    expect(runwayConditionFromWeather(['-RA'], 12)).toBe('wet')
    expect(runwayConditionFromWeather(['+RA'], 12)).toBe('flooded')
    expect(runwayConditionFromWeather(['TSRA'], 20)).toBe('flooded')
    expect(runwayConditionFromWeather(['FZRA'], -2)).toBe('ice')
    expect(runwayConditionFromWeather(['-RA'], -1)).toBe('ice')
    expect(runwayConditionFromWeather(['SN'], -6)).toBe('snow')
    expect(runwayConditionFromWeather(['SN'], 2)).toBe('slush')
    expect(runwayConditionFromWeather(['VCSH', 'BR'], 10)).toBe('dry')
  })

  it('hydroplanes above 9·√p knots on standing water', () => {
    expect(hydroplaningSpeedMs(200) / 0.514444).toBeCloseTo(9 * Math.sqrt(200), 6)
    expect(tirePressurePsiFor(B738.mtowKg)).toBe(200)
    expect(tirePressurePsiFor(C172S.mtowKg)).toBe(35)
    expect(surfaceFriction('flooded', 70, 200).hydroplaning).toBe(true)
    expect(surfaceFriction('flooded', 50, 200).hydroplaning).toBe(false)
    expect(surfaceFriction('wet', 90, 200).hydroplaning).toBe(false)
  })

  it('a C172 needs more runway to stop on wet and far more on ice', () => {
    const stop = (scale: number): number => {
      const ac = new Aircraft()
      ac.spawnOnGround(0, 0, 0)
      ac.controls.throttle = 0
      for (let t = 0; t < 2; t += 1 / 120) ac.step(1 / 120) // settle
      ac.velBody.x = 22 // ≈ 43 kt
      ac.env.brakeMuScale = scale
      ac.controls.brakeLeft = 1; ac.controls.brakeRight = 1
      const x0 = ac.posNed.x
      for (let t = 0; t < 60; t += 1 / 120) {
        ac.step(1 / 120)
        if (t > 0.1 && ac.data.groundSpeedKt < 0.5) break
      }
      return ac.posNed.x - x0
    }
    const dry = stop(1), wet = stop(0.6), ice = stop(0.12)
    expect(wet).toBeGreaterThan(dry * 1.3)
    expect(ice).toBeGreaterThan(dry * 3)
  })
})

describe('airframe icing', () => {
  it('accretes in supercooled cloud at a realistic rate and not outside the window', () => {
    const ice = new AirframeIce()
    for (let t = 0; t < 600; t++) ice.step({ dt: 1, oatC: -6, inCloud: 1, precip: 'none', tasMs: 55, protectedAirframe: false })
    expect(ice.thicknessMm).toBeGreaterThan(2) // ≈ 0.4–0.6 mm/min
    expect(ice.thicknessMm).toBeLessThan(6)
    const cold = new AirframeIce()
    for (let t = 0; t < 600; t++) cold.step({ dt: 1, oatC: -30, inCloud: 1, precip: 'none', tasMs: 55, protectedAirframe: false })
    expect(cold.thicknessMm).toBe(0) // glaciated cloud
    expect(supercooledFraction(2)).toBe(0)
  })

  it('freezing rain is far worse; anti-ice nearly stops it; warm air melts it', () => {
    const fz = new AirframeIce(), prot = new AirframeIce(), clear = new AirframeIce()
    for (let t = 0; t < 300; t++) {
      fz.step({ dt: 1, oatC: -2, inCloud: 0, precip: 'freezingRain', tasMs: 55, protectedAirframe: false })
      prot.step({ dt: 1, oatC: -2, inCloud: 0, precip: 'freezingRain', tasMs: 55, protectedAirframe: true })
      clear.step({ dt: 1, oatC: -2, inCloud: 0, precip: 'none', tasMs: 55, protectedAirframe: false })
    }
    expect(fz.thicknessMm).toBeGreaterThan(5)
    expect(prot.thicknessMm).toBeLessThan(fz.thicknessMm * 0.06)
    expect(clear.thicknessMm).toBe(0)
    for (let t = 0; t < 900; t++) fz.step({ dt: 1, oatC: 5, inCloud: 0, precip: 'none', tasMs: 55, protectedAirframe: false })
    expect(fz.thicknessMm).toBe(0)
    expect(precipitationFromWeather(['-FZDZ'])).toBe('freezingRain')
  })

  it('costs lift and adds drag: the iced wing stalls at a lower CL', () => {
    const ice = new AirframeIce()
    ice.thicknessMm = 10
    expect(ice.clMaxFactor).toBeLessThan(0.8)
    expect(ice.cdIncrement).toBeGreaterThan(0.01)
    const out: AeroOutput = { force: v3(), moment: v3(), cl: 0, cd: 0, stallFraction: 0 }
    const base = { rho: 1.225, vAir: 30, beta: 0, alphaDot: 0, p: 0, q: 0, r: 0, elevatorRad: 0, aileronRad: 0, rudderRad: 0, flapsDeg: 0, thrustN: 0, propTorqueNm: 0, heightAglM: 500 }
    let clean = 0, iced = 0
    for (let a = 0; a < 0.35; a += 0.002) {
      clean = Math.max(clean, computeAero({ ...base, alpha: a }, out, C172S).cl)
      iced = Math.max(iced, computeAero({ ...base, alpha: a, clMaxFactor: ice.clMaxFactor }, out, C172S).cl)
    }
    expect(iced).toBeLessThan(clean * 0.85)
  })
})

describe('structural limits', () => {
  it('maps the fleet onto certification categories', () => {
    expect(structuralCategoryFor(C172S)).toBe('normal')
    expect(structuralCategoryFor(B738)).toBe('transport')
    expect(loadLimitsFor(C172S).posG).toBe(3.8)
    expect(loadLimitsFor(B738).posG).toBe(2.5)
    const extra = rosterParams('E300')
    if (extra) expect(structuralCategoryFor(extra)).toBe('aerobatic')
    const ls8 = rosterParams('LS8')
    if (ls8) expect(structuralCategoryFor(ls8)).toBe('utility')
  })

  it('latches overstress above limit, fails a wing beyond ultimate', () => {
    const m = new StructureMonitor(C172S)
    expect(m.step(0.01, 3.7, 0)).toBeNull()
    expect(m.step(0.01, 4.1, 0)).toBe('overstress')
    expect(m.step(0.01, 4.1, 0)).toBeNull() // once per excursion
    expect(m.overstressed).toBe(true)
    expect(m.wingFailure).toBe(0)
    let ev: string | null = null
    for (let i = 0; i < 10; i++) ev = m.step(0.01, 6.2, 0, 0.5) ?? ev
    expect(ev).toBe('failure')
    expect(m.wingFailure).toBe(-1) // rolling right loads the left wing
    const flaps = new StructureMonitor(C172S)
    expect(flaps.step(0.01, 2.4, 20)).toBe('overstress') // +2.0 g with flaps
    const safe = new StructureMonitor(C172S)
    safe.failuresEnabled = false
    for (let i = 0; i < 20; i++) safe.step(0.01, 7, 0)
    expect(safe.wingFailure).toBe(0)
  })

  it('a failed wing rolls the airplane hard toward it and costs lift', () => {
    const ac = new Aircraft()
    const t = trim({ tasMs: 55, altM: 1000, massKg: ac.massKg, flapsDeg: 0, gammaRad: 0 })
    ac.applyTrimState(55, t.alphaRad, 1000, 0, t.gammaRad, t.elevatorRad, t.throttle, t.rpm)
    ac.env.wingFailure = 1
    for (let s = 0; s < 1; s += 1 / 120) ac.step(1 / 120)
    expect(ac.data.rollDeg).toBeGreaterThan(30)
    expect(ac.data.verticalSpeedFpm).toBeLessThan(-300)
  })
})

describe('environment orchestration', () => {
  const state = (over: Partial<EnvironmentState> = {}): EnvironmentState => ({
    timeS: 600, dt: 1 / 120, n: 0, e: 0, altM: 1000, aglM: 900, tasMs: 55, headingRad: 0, trackRad: 0,
    groundSpeedMs: 55, onGround: false, loadFactorG: 1, flapsDeg: 0, rollRate: 0, oatC: 10, inCloud: 0,
    weather: [], sunElevDeg: -10, cloudCover: 0, overWater: false, groundElevAt: null, windN: 0, windE: 0,
    turbulenceRollGust: 0, ...over,
  })
  const hooks = () => ({ iceCdInc: 0, clMaxFactor: 1, rollGustRate: 0, brakeMuScale: 1, latMuScale: 1, rollingScale: 1, wingFailure: 0 as -1 | 0 | 1 })

  it('is inert in calm, clear, dry night air with no traffic', () => {
    const env = new Environment(C172S)
    const w = v3(), h = hooks()
    for (let i = 0; i < 240; i++) expect(env.step(state(), w, h)).toEqual([])
    expect([w.x, w.y, w.z]).toEqual([0, 0, 0])
    expect(h).toEqual(hooks())
  })

  it('reports icing, hydroplaning, windshear and overstress as discrete events', () => {
    const env = new Environment(C172S)
    const h = hooks()
    const ev: string[] = []
    for (let i = 0; i < 120 * 300; i++) ev.push(...env.step(state({ dt: 1 / 120, timeS: 600 + i / 120, oatC: -5, inCloud: 1 }), v3(), h).map(e => e.kind))
    expect(ev).toContain('icing')
    expect(h.clMaxFactor).toBeLessThan(1)
    const jet = new Environment(B738)
    jet.spawnMicroburstAhead(0, 0, 0, 0, 2000)
    const jh = hooks(), jev: string[] = []
    for (let t = 0; t < 60; t += 1 / 60) jev.push(...jet.step(state({ dt: 1 / 60, timeS: t, n: 75 * t, aglM: 250, altM: 250, tasMs: 75, sunElevDeg: -10 }), v3(), jh).map(e => e.kind))
    expect(jev).toContain('windshear')
    const wet = new Environment(B738)
    const wh = hooks()
    expect(wet.step(state({ onGround: true, aglM: 0, groundSpeedMs: 70, weather: ['+RA'], surfaceTempC: 12 }), v3(), wh).map(e => e.kind)).toContain('hydroplaning')
    expect(wh.brakeMuScale).toBeLessThan(0.1)
    const pull = new Environment(C172S)
    expect(pull.step(state({ loadFactorG: 4.5 }), v3(), hooks()).map(e => e.kind)).toContain('overstress')
  })

  it('anti-ice: AUTO/ON protect a jet, OFF lets it ice; unprotected airframes have none', () => {
    const icing = (env: Environment): number => {
      const h = hooks()
      for (let i = 0; i < 120 * 120; i++) env.step(state({ dt: 1 / 120, timeS: i / 120, oatC: -6, inCloud: 1, tasMs: 120 }), v3(), h)
      return env.ice.thicknessMm
    }
    const auto = new Environment(B738), off = new Environment(B738)
    off.antiIce = 'off'
    expect(off.iceProtectionFitted && !off.protectedAirframe).toBe(true)
    expect(icing(off)).toBeGreaterThan(icing(auto) * 10)
    expect(auto.status.icingConditions).toBe(true)
    expect(new Environment(C172S).iceProtectionFitted).toBe(false)
  })

  it('saves and restores the airframe condition, ignoring malformed fields', () => {
    const a = new Environment(B738)
    a.ice.thicknessMm = 3.5
    a.structure.overstressed = true
    a.structure.wingFailure = -1
    a.structure.maxG = 3.1
    a.antiIce = 'off'
    const snap = JSON.parse(JSON.stringify(a.snapshot()))
    const b = new Environment(B738)
    b.restore(snap)
    expect(b.snapshot()).toEqual(a.snapshot())
    const c = new Environment(B738)
    c.restore({ iceMm: Number.NaN, wingFailure: 7 as never, antiIce: 'maybe' as never, overstressed: 'yes' as never })
    expect(c.snapshot()).toEqual(new Environment(B738).snapshot())
    c.restore(undefined)
    // A restored failure reaches the aircraft hooks even on the ground.
    const h = hooks()
    b.step(state({ onGround: true, aglM: 0 }), v3(), h)
    expect(h.wingFailure).toBe(-1)
  })

  it('never judges gear contact as a wing load (spawning into the ground broke the wings)', () => {
    const env = new Environment(C172S)
    const h = hooks()
    for (let i = 0; i < 60; i++) expect(env.step(state({ onGround: true, aglM: 0, loadFactorG: 40 }), v3(), h)).toEqual([])
    expect(env.structure.overstressed).toBe(false)
    expect(h.wingFailure).toBe(0)
  })
})
