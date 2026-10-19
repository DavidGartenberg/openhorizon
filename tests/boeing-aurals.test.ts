import {describe,expect,it} from 'vitest'
import {boeingAurals,makeAuralLatches,WAILER_MIN_S,type AuralObs} from '../src/sim/boeing-aurals'

const base: AuralObs = {
  onGround:true,kias:0,vmoKt:340,mach:0,mmo:0.82,stallFraction:0,alphaDeg:2,throttle:0,flapsDeg:5,
  gearDownLocked:true,gearRetractable:true,radioAltFt:0,speedbrakeStowed:true,parkingBrake:false,stabInGreenBand:true,
  apEngaged:false,altitudeFt:0,selectedAltFt:5000,
}
const run = (o: Partial<AuralObs>, L = makeAuralLatches(), t = 0) => boeingAurals({...base,...o},L,t)

describe('737NG takeoff configuration warning (intermittent horn)', () => {
  it('is silent with a valid takeoff configuration', () => {
    expect(run({throttle:0.9}).continuous.has('configHorn')).toBe(false)
  })
  it.each([
    ['flaps up',{flapsDeg:0}],['flaps 30',{flapsDeg:30}],['speedbrake not down',{speedbrakeStowed:false}],
    ['parking brake set',{parkingBrake:true}],['stab trim out of green band',{stabInGreenBand:false}],
  ])('sounds for %s once thrust is advanced', (_n, bad) => {
    expect(run({throttle:0.9,...bad}).continuous.has('configHorn')).toBe(true)
    expect(run({throttle:0.3,...bad}).continuous.has('configHorn')).toBe(false)
  })
  it('never sounds airborne', () => {
    expect(run({onGround:false,throttle:0.9,flapsDeg:0,radioAltFt:3000}).continuous.has('configHorn')).toBe(false)
  })
})

describe('737NG landing gear configuration warning (steady horn)', () => {
  const air = {onGround:false,gearDownLocked:false,radioAltFt:600}
  it('flaps 15 + idle sounds; flaps 15 with thrust does not', () => {
    expect(run({...air,flapsDeg:15,throttle:0}).continuous.has('gearHorn')).toBe(true)
    expect(run({...air,flapsDeg:15,throttle:0.5}).continuous.has('gearHorn')).toBe(false)
  })
  it('flaps 30 sounds regardless of thrust', () => {
    expect(run({...air,flapsDeg:30,throttle:0.9}).continuous.has('gearHorn')).toBe(true)
  })
  it('low flaps + idle below 800 RA sounds and HORN CUTOUT silences it; not above 800 RA', () => {
    const L = makeAuralLatches()
    expect(run({...air,flapsDeg:5,throttle:0},L).continuous.has('gearHorn')).toBe(true)
    expect(run({...air,flapsDeg:5,throttle:0,hornCutout:true},L).continuous.has('gearHorn')).toBe(false)
    expect(run({...air,flapsDeg:5,throttle:0},L).continuous.has('gearHorn')).toBe(false)
    expect(run({...air,flapsDeg:5,throttle:0,radioAltFt:1200}).continuous.has('gearHorn')).toBe(false)
  })
  it('HORN CUTOUT cannot silence the landing-flap horn', () => {
    const L = makeAuralLatches()
    expect(run({...air,flapsDeg:30,hornCutout:true},L).continuous.has('gearHorn')).toBe(true)
  })
  it('gear down and locked or fixed gear: silent', () => {
    expect(run({...air,flapsDeg:30,gearDownLocked:true}).continuous.has('gearHorn')).toBe(false)
    expect(run({...air,flapsDeg:30,gearRetractable:false}).continuous.has('gearHorn')).toBe(false)
  })
})

describe('overspeed clacker, stick shaker, fire bell', () => {
  it('clacker above Vmo or Mmo only', () => {
    expect(run({onGround:false,kias:345}).continuous.has('clacker')).toBe(true)
    expect(run({onGround:false,kias:300,mach:0.83}).continuous.has('clacker')).toBe(true)
    expect(run({onGround:false,kias:330,mach:0.8}).continuous.has('clacker')).toBe(false)
  })
  it('stick shaker airborne near stall at positive AoA', () => {
    expect(run({onGround:false,stallFraction:0.3,alphaDeg:12}).continuous.has('stickShaker')).toBe(true)
    expect(run({onGround:false,stallFraction:0.3,alphaDeg:-12}).continuous.has('stickShaker')).toBe(false)
    expect(run({onGround:true,stallFraction:0.3,alphaDeg:12}).continuous.has('stickShaker')).toBe(false)
  })
  it('the fire bell only rings on the FIRE WARN test (no fire model exists)', () => {
    expect(run({}).continuous.has('fireBell')).toBe(false)
    expect(run({fireTest:true}).continuous.has('fireBell')).toBe(true)
  })
})

describe('autopilot disconnect wailer', () => {
  it('sounds for the minimum two seconds after disengagement', () => {
    const L = makeAuralLatches()
    run({onGround:false,apEngaged:true},L,10)
    expect(run({onGround:false,apEngaged:false},L,10.1).continuous.has('apWailer')).toBe(true)
    expect(run({onGround:false,apEngaged:false},L,10.1+WAILER_MIN_S-0.05).continuous.has('apWailer')).toBe(true)
    expect(run({onGround:false,apEngaged:false},L,10.1+WAILER_MIN_S+0.05).continuous.has('apWailer')).toBe(false)
  })
  it('a second disconnect press silences it; re-engaging cancels it', () => {
    const L = makeAuralLatches()
    run({apEngaged:true},L,0); run({apEngaged:false,apDisconnectPressed:true},L,0.05)
    expect(run({apEngaged:false},L,0.5).continuous.has('apWailer')).toBe(true)
    expect(run({apEngaged:false,apDisconnectPressed:true},L,0.6).continuous.has('apWailer')).toBe(false)
    const M = makeAuralLatches()
    run({apEngaged:true},M,0); run({apEngaged:false},M,0.1)
    expect(run({apEngaged:true},M,0.2).continuous.has('apWailer')).toBe(false)
  })
  it('never sounds when the AP was never engaged', () => {
    expect(run({apEngaged:false}).continuous.has('apWailer')).toBe(false)
  })
})

describe('altitude alert tone', () => {
  it('fires once on a >300 ft deviation after capture, re-arms on recapture or a new selection', () => {
    const L = makeAuralLatches(), air = {onGround:false,selectedAltFt:10000}
    expect(run({...air,altitudeFt:8000},L).oneShots).toEqual([]) // climbing toward it: no capture yet
    expect(run({...air,altitudeFt:9950},L).oneShots).toEqual([]) // captured
    expect(run({...air,altitudeFt:10250},L).oneShots).toEqual([])
    expect(run({...air,altitudeFt:10350},L).oneShots).toEqual(['altAlert'])
    expect(run({...air,altitudeFt:10500},L).oneShots).toEqual([]) // once
    run({...air,altitudeFt:10100},L) // recaptured
    expect(run({...air,altitudeFt:9600},L).oneShots).toEqual(['altAlert'])
    expect(run({...air,selectedAltFt:20000,altitudeFt:9600},L).oneShots).toEqual([]) // new selection
  })
})
