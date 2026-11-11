import { describe, expect, it } from 'vitest'
import { archetypeFor } from '../src/world/fleet-map'
import { chooseTrafficModel, trafficConfiguration, XP_NATIVE_SIZE } from '../src/render/traffic-model'
import { XP_MODELS } from '../src/render/xplane-manifest'

const spec = (des: string, desc = '', wtc = '') => archetypeFor(des, desc, wtc)

describe('which X-Plane exterior draws each traffic type', () => {
  it('every model it can pick is one the install manifest knows', () => {
    for (const des of ['B738', 'A320', 'A333', 'B77W', 'MD88', 'C172', 'SR22', 'BE58', 'PA18', 'C56X', 'E190', 'CRJ9', 'J3', 'B350', 'AS21']) {
      const c = chooseTrafficModel(spec(des), des)
      if (c) expect(XP_MODELS[c.key], `${des} → ${c.key}`).toBeTruthy()
    }
  })
  it('narrowbody airliners use the 737, scaled to the type', () => {
    const b = chooseTrafficModel(spec('B738'), 'B738')!
    expect(b.key).toBe('B738'); expect(b.scale).toBeCloseTo(1, 1)
    const a21 = chooseTrafficModel(spec('A21N'), 'A21N')!
    expect(a21.key).toBe('B738'); expect(a21.scale).toBeGreaterThan(1.05); expect(a21.scale).toBeLessThan(1.2)
    const crj = chooseTrafficModel(spec('CRJ2'), 'CRJ2')!
    expect(crj.key).toBe('B738'); expect(crj.scale).toBeLessThan(0.8)
  })
  it('the MD-80 family uses the MD-82, the A330 its own model, other widebodies the A330 when heavy models are allowed', () => {
    expect(chooseTrafficModel(spec('MD88'), 'MD88')!.key).toBe('MD82')
    expect(chooseTrafficModel(spec('A333'), 'A333')!.key).toBe('A333')
    expect(chooseTrafficModel(spec('B77W'), 'B77W', { allowHeavy: true })!.key).toBe('A333')
    const light = chooseTrafficModel(spec('B77W'), 'B77W', { allowHeavy: false })!
    expect(light.key).toBe('B738'); expect(light.scale).toBeGreaterThan(1.5)
  })
  it('light aircraft use the matching Cessna / Cirrus / Piper / Baron / Citation', () => {
    expect(chooseTrafficModel(spec('C172'), 'C172')!.key).toBe('C172')
    expect(chooseTrafficModel(spec('SR22'), 'SR22')!.key).toBe('SR22')
    expect(chooseTrafficModel(spec('PA18'), 'PA18')!.key).toBe('PA18')
    expect(chooseTrafficModel(spec('BE58'), 'BE58')!.key).toBe('BE58')
    expect(chooseTrafficModel(spec('C56X'), 'C56X')!.key).toBe('C750')
  })
  it('scale is never extreme, and rotorcraft / unknown shapes keep their silhouette', () => {
    for (const des of ['B738', 'A320', 'CRJ2', 'E190', 'C172', 'B350', 'C56X']) {
      const c = chooseTrafficModel(spec(des), des)!
      expect(c.scale).toBeGreaterThan(0.5); expect(c.scale).toBeLessThan(2.6)
    }
    expect(chooseTrafficModel({ archetype: 'rotorcraft', spanM: 10, lengthM: 12, engines: 1 }, 'R22')).toBeNull()
    expect(chooseTrafficModel({ archetype: 'generic', spanM: 10, lengthM: 8, engines: 1 }, 'ZZZZ')).toBeNull()
  })
  it('knows the real length of each model it scales from', () => {
    expect(XP_NATIVE_SIZE.B738!.lengthM).toBeCloseTo(39.5, 0)
    for (const k of Object.keys(XP_NATIVE_SIZE)) expect(XP_MODELS[k], k).toBeTruthy()
  })
})

describe('what the traffic configuration looks like (cosmetic, from observed kinematics)', () => {
  it('on the ground: gear down, flaps up, no prop blur when parked', () => {
    expect(trafficConfiguration({ gnd: true, gsKt: 0, aglFt: 0, vsFpm: 0 })).toMatchObject({ gearPos: 1, flapFrac: 0, rpm: 0 })
  })
  it('taxiing and rolling: gear down, props turning', () => {
    const c = trafficConfiguration({ gnd: true, gsKt: 60, aglFt: 0, vsFpm: 0 })
    expect(c.gearPos).toBe(1); expect(c.rpm).toBeGreaterThan(900)
  })
  it('final approach: gear down and flaps out', () => {
    const c = trafficConfiguration({ gnd: false, gsKt: 140, aglFt: 1200, vsFpm: -700 })
    expect(c.gearPos).toBe(1); expect(c.flapFrac).toBeGreaterThan(0.4)
  })
  it('climbing out low and slow keeps the gear for a moment; cruise is clean', () => {
    expect(trafficConfiguration({ gnd: false, gsKt: 160, aglFt: 200, vsFpm: 2500 }).gearPos).toBe(1)
    const cruise = trafficConfiguration({ gnd: false, gsKt: 450, aglFt: 30000, vsFpm: 0 })
    expect(cruise.gearPos).toBe(0); expect(cruise.flapFrac).toBe(0)
  })
  it('never returns NaN for missing data', () => {
    const c = trafficConfiguration({ gnd: false, gsKt: NaN, aglFt: NaN, vsFpm: NaN })
    for (const v of Object.values(c)) expect(Number.isFinite(v)).toBe(true)
  })
})
