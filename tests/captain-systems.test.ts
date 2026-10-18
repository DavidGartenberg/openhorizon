import { describe, expect, it } from 'vitest'
import { createCaptainSystems, stepCaptainSystems, type CaptainSystemsInput } from '../src/sim/captain-systems'
import { Aircraft } from '../src/sim/aircraft'
import { B738 } from '../src/sim/aircraft/b738'

const ground: CaptainSystemsInput = { fuelAvailable: true, electricalPower: true, onGround: true, groundSpeedKt: 0, throttle: 0, manualBrake: 0 }

describe('aggregate jet engine groups', () => {
  it('scales powered thrust and fuel while retaining dead-fan drag', () => {
    const full = new Aircraft(B738)
    const half = new Aircraft(B738)
    const dead = new Aircraft(B738)
    half.jetPowerFactor = 0.5
    dead.jetPowerFactor = 0
    for (const aircraft of [full, half, dead]) {
      aircraft.posNed.z = -1000
      aircraft.velBody.x = 100
      aircraft.controls.throttle = 0.8
      aircraft.step(0.02)
    }
    expect(half.prop.fuelFlowKgS).toBeCloseTo(full.prop.fuelFlowKgS / 2, 8)
    expect(dead.prop.fuelFlowKgS).toBe(0)
    expect(dead.prop.thrustN).toBeLessThan(0)
    expect(half.prop.thrustN).toBeCloseTo((full.prop.thrustN + dead.prop.thrustN) / 2, 8)
  })
})

describe('Captain engine masters and ignition', () => {
  it('latches individual shutdown commands without toggling on held inputs', () => {
    const initial = createCaptainSystems()
    const one = stepCaptainSystems(initial, { ...ground, engineMaster1: false }, 1)
    expect(initial.engine1Running).toBe(true)
    expect(one.enginePowerFraction).toBe(0.5)
    expect(stepCaptainSystems(one, ground, 1).enginePowerFraction).toBe(0.5)
    expect(stepCaptainSystems(one, { ...ground, engineMaster1: false }, 1).engine2Running).toBe(true)
  })
  it('requires START, master, fuel, electrical supply, and start time', () => {
    let s = createCaptainSystems(false)
    s = stepCaptainSystems(s, { ...ground, engineMaster1: true }, 10)
    expect(s.engine1Running).toBe(false)
    s = stepCaptainSystems(s, { ...ground, ignitionMode: 'crank' }, 10)
    expect(s.engine1Running).toBe(false)
    s = stepCaptainSystems(s, { ...ground, ignitionMode: 'start', electricalPower: false }, 10)
    expect(s.engine1Running).toBe(false)
    s = stepCaptainSystems(s, ground, 3)
    expect(s.engine1Running).toBe(false)
    s = stepCaptainSystems(s, ground, 3)
    expect(s.enginePowerFraction).toBe(0.5)
    expect(stepCaptainSystems(s, { ...ground, ignitionMode: 'norm' }, 1).engine1Running).toBe(true)
    expect(stepCaptainSystems(s, { ...ground, fuelAvailable: false }, 1).enginePowerFraction).toBe(0)
  })
})

describe('rudder trim', () => {
  it('moves only while held, clamps and resets', () => {
    let s = stepCaptainSystems(createCaptainSystems(), { ...ground, trimRight: true }, 1)
    expect(s.rudderTrim).toBeGreaterThan(0)
    expect(stepCaptainSystems(s, ground, 1).rudderTrim).toBe(s.rudderTrim)
    expect(stepCaptainSystems(s, { ...ground, trimLeft: true }, 1).rudderTrim).toBeCloseTo(0)
    s = stepCaptainSystems(s, { ...ground, trimRight: true }, 100)
    expect(s.rudderTrim).toBe(0.3)
    expect(stepCaptainSystems(s, { ...ground, trimReset: true, trimRight: true }, 1).rudderTrim).toBe(0)
  })
})

describe('autobrake', () => {
  it('does not brake parked or during ordinary taxi', () => {
    let s = stepCaptainSystems(createCaptainSystems(), { ...ground, autobrakeMode: 'max' }, 1)
    expect(s.autobrakeDemand).toBe(0)
    s = stepCaptainSystems(s, { ...ground, groundSpeedKt: 20 }, 1)
    expect(s.autobrakeDemand).toBe(0)
  })
  it.each(['low', 'medium', 'max'] as const)('activates %s after touchdown and releases at low speed', mode => {
    let s = stepCaptainSystems(createCaptainSystems(), { ...ground, onGround: false, groundSpeedKt: 130, autobrakeMode: mode }, 1)
    expect(s.autobrakeDemand).toBe(0)
    s = stepCaptainSystems(s, { ...ground, groundSpeedKt: 100 }, 1)
    expect(s.autobrakeDemand).toBeGreaterThan(0)
    expect(stepCaptainSystems(s, { ...ground, groundSpeedKt: 3 }, 1).autobrakeDemand).toBe(0)
  })
  it('manual brake disarms until selector is cycled', () => {
    let s = stepCaptainSystems(createCaptainSystems(), { ...ground, onGround: false, autobrakeMode: 'medium' }, 1)
    s = stepCaptainSystems(s, { ...ground, groundSpeedKt: 100 }, 1)
    s = stepCaptainSystems(s, { ...ground, groundSpeedKt: 90, manualBrake: 0.2 }, 1)
    expect(s.autobrakeDemand).toBe(0)
    expect(stepCaptainSystems(s, { ...ground, groundSpeedKt: 80, autobrakeMode: 'medium' }, 1).autobrakeDemand).toBe(0)
  })
  it('RTO requires takeoff power and speed, then brakes when power is rejected', () => {
    let s = stepCaptainSystems(createCaptainSystems(), { ...ground, groundSpeedKt: 90, autobrakeMode: 'rto' }, 1)
    expect(s.autobrakeDemand).toBe(0)
    s = stepCaptainSystems(s, { ...ground, groundSpeedKt: 90, throttle: 0.9 }, 1)
    expect(s.rtoArmed).toBe(true)
    expect(s.autobrakeDemand).toBe(0)
    s = stepCaptainSystems(s, { ...ground, groundSpeedKt: 90 }, 1)
    expect(s.autobrakeDemand).toBe(1)
    expect(stepCaptainSystems(s, { ...ground, groundSpeedKt: 90, throttle: 0.9 }, 1).autobrakeDemand).toBe(0)
  })
})

it('records final applied control surfaces for animation, with trim already mixed into yaw',()=>{
 const a=new Aircraft(B738)
 a.controls.yaw=.5;a.controls.pitch=.2;a.controls.trim=.1;a.controls.roll=-.3
 a.posNed.z=-1000;a.velBody.x=100;a.step(.02)
 expect(a.appliedControlSurfaces.yaw).toBe(.5)
 expect(a.appliedControlSurfaces.rudderRad).toBeCloseTo(-.5*a.P.rudderMaxRad)
 expect(a.appliedControlSurfaces.aileronRad).toBeCloseTo(-.3*a.P.aileronMaxRad)
 a.controls.yaw=.2
 expect(a.appliedControlSurfaces.yaw).toBe(.5)
})

it('keeps stabilizer trim separate from elevator motion and clears the complete snapshot on reset',()=>{
 const a=new Aircraft(B738)
 a.controls.pitch=.2;a.controls.trim=.3;a.posNed.z=-1000;a.velBody.x=100;a.step(.02)
 expect(a.appliedControlSurfaces.trim).toBe(.3)
 expect(a.appliedControlSurfaces.elevatorSurfaceRad).toBeCloseTo(-.2*a.P.elevatorMaxRad)
 expect(a.appliedControlSurfaces.stabilizerRad).toBeCloseTo(-.3*a.P.trimMaxRad)
 expect(a.appliedControlSurfaces.elevatorSurfaceRad+a.appliedControlSurfaces.stabilizerRad).toBeCloseTo(a.appliedControlSurfaces.elevatorRad)
 a.spawnOnGround(0,0,0)
 expect(Object.values(a.appliedControlSurfaces).every(v=>v===0)).toBe(true)
})
