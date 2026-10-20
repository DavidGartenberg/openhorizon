import { describe, expect, it } from 'vitest'
import { Aircraft } from '../src/sim/aircraft'
import { rosterParams } from '../src/sim/aircraft/roster'
import { flapInterp } from '../src/sim/aircraft/c172s'
const p = rosterParams('DG80')!
describe('DG800 signed simulation', () => {
 it('interpolates signed and invalid angles at neutral', () => {
  expect(flapInterp([-9,0,13], -5, [-9,0,13])).toBe(-5)
  expect(flapInterp([-9,0,13], NaN, [-9,0,13])).toBe(0)
 })
 it('starts and respawns at the physical neutral detent', () => {
  const a = new Aircraft(p)
  expect(p.flapDetentsDeg).toHaveLength(7)
  expect(a.controls.flapsIndex).toBe(2)
  a.controls.flapsIndex = 0; a.flapsDeg = -9; a.spawnOnGround(0,0,0)
  expect(a.controls.flapsIndex).toBe(2); expect(a.flapsDeg).toBe(0)
 })
})
it('uses one physical differential output for aero at every signed setting and roll', () => {
 for (let i=0;i<7;i++) for (const roll of [-1,0,1]) {
  const a = new Aircraft(p); a.resetFlaps(i); a.applyTrimState(30,0.03,1000,0,0,0,0,0); a.controls.roll=roll; a.step(1/120)
  const out = a.appliedControlSurfaces
  expect(out.flapsDeg).toBeCloseTo((out.flaperonLeftRad+out.flaperonRightRad)*90/Math.PI,10)
  const actual=(a as unknown as {aeroIn:{flapsDeg:number;aileronRad:number}}).aeroIn
  expect(actual.flapsDeg).toBe(out.flapsDeg);expect(actual.aileronRad).toBe(out.aileronRad)
  expect(out.aileronRad).toBeCloseTo((out.flaperonLeftRad-out.flaperonRightRad)/2,10)
  expect(out.flaperonLeftRad).toBeCloseTo(p.flapDetentsDeg[i]!*Math.PI/180 + (roll<0 ? -Math.asin(42/122) : roll*Math.asin(21/122)),10)
 }
})
it('holds displaced flap after retraction until a deliberate selection; steady poll does not release', () => {
 const a = new Aircraft(p); a.resetFlaps(0); a.applyTrimState(30,0.03,1000,0,0,0,0,0)
 a.spoilerCmd=1
 for(let i=0;i<240;i++) a.step(1/120)
 expect(a.flapsDeg).toBeCloseTo(5,8)
 a.spoilerCmd=0
 for(let i=0;i<240;i++) { a.selectFlaps(0,false); a.step(1/120) }
 expect(a.flapsDeg).toBeCloseTo(5,8)
 a.selectFlaps(0)
 for(let i=0;i<240;i++) a.step(1/120)
 expect(a.flapsDeg).toBeCloseTo(-9,8)
 a.controls.flapsIndex=NaN; a.step(1/120)
 expect(a.controls.flapsIndex).toBe(2); expect(Number.isFinite(a.flapsDeg)).toBe(true)
})
it('rejects invalid coefficient metadata after tuning and derives landing speed from final tables', async () => {
 const {deriveParams}=await import('../src/sim/aircraft/derive'); const {ROSTER}=await import('../src/sim/aircraft/roster')
 const entry=ROSTER.find(e=>e.spec.designator==='DG80')!
 expect(()=>deriveParams({...entry.spec,tuning:{...entry.spec.tuning,flapDCd:[0]}},entry.opts)).toThrow()
 const changed=deriveParams({...entry.spec,tuning:{...entry.spec.tuning,flapDClMax:[0,0,0,0,0,0,0.5]}},entry.opts)
 expect(changed.vSpeeds.vs0).toBe(Math.round(Math.sqrt(2*525*9.80665/(1.225*11.8*(changed.clMaxClean+0.5)))/0.5144444444444445))
})
it('keeps partial linkage subdivision invariant and higher positive settings unaffected', () => {
 function run(dt:number,index:number){const a=new Aircraft(p);a.resetFlaps(index);a.applyTrimState(30,0.03,1000,0,0,0,0,0);a.spoilerCmd=.5;for(let t=0;t<1.99;t+=dt)a.step(dt);return a}
 const a=run(1/120,0),b=run(1/240,0)
 expect(a.flapsDeg).toBeCloseTo(-2,8);expect(a.flapsDeg).toBeCloseTo(b.flapsDeg,8)
 expect(run(1/120,4).flapsDeg).toBe(10)
 a.spawnOnGround(0,0,0);expect(a.heldFlapFloorDeg).toBe(-9);expect(a.appliedControlSurfaces.flapsDeg).toBe(0)
})
it('produces attainable trim and distinct actual forces across signed settings', async () => {
 const {trim,stallTasMs}=await import('../src/sim/trim');const {KT}=await import('../src/sim/atmosphere')
 const forces:number[]=[]
 for(let i=0;i<7;i++){
  const deg=p.flapDetentsDeg[i]!,t=trim({tasMs:30,altM:1000,massKg:525,flapsDeg:deg,throttle:0,params:p})
  expect(t.converged).toBe(true);expect(t.residual).toBeLessThan(.01)
  const a=new Aircraft(p);a.resetFlaps(i);a.applyTrimState(30,t.alphaRad,1000,0,t.gammaRad,t.elevatorRad,0,t.rpm);a.step(1/120)
  expect(Number.isFinite(a.data.kias)).toBe(true);forces.push(a.data.verticalSpeedFpm)
 }
 expect(new Set(forces).size).toBe(7)
 for(const [deg,v]of [[-9,88],[0,84],[13,77],[p.flapDetentsDeg[6]!,76]]) expect(stallTasMs(525,0,deg!,p)*3.6).toBeCloseTo(v!,2)
 const t=trim({tasMs:54*KT,altM:1000,massKg:525,flapsDeg:0,throttle:0,params:p})
 console.log("DG80 neutral glide at 54kt TAS /1000m /525kg",-1/Math.tan(t.gammaRad),"residual",t.residual)
 expect(-1/Math.tan(t.gammaRad)).toBeGreaterThan(35)
})
it('labels glider airbrakes and suppresses powered-aircraft flap/takeoff calls', async()=>{
 const {cycleSpeedbrake}=await import('../src/input/speedbrake-control')
 expect(cycleSpeedbrake(new Aircraft(p))).toBe('AIRBRAKES FULL')
 const {copilotCallouts,makeCopilotLatches}=await import('../src/sim/copilot')
 const s={kias:70,aglFt:500,vsFpm:600,onGround:false,gearDown:true,flapsIndex:2,flapsDeg:0,throttle:0,glider:true}
 expect(copilotCallouts(s,s,{vrKt:50,v1Kt:0,flapsUpKt:55},makeCopilotLatches(),false)).not.toContain('flaps up speed')
 expect(copilotCallouts(s,s,{vrKt:50,v1Kt:0,flapsUpKt:55},makeCopilotLatches(),false)).not.toContain('positive rate')
 const {TawsComputer}=await import('../src/sim/taws')
 const t=new TawsComputer();const o=t.step(1,{aglFt:200,altFt:200,vsFpm:0,gsKt:70,headingDeg:0,rollDeg:0,flapsDeg:0,sinceTakeoffS:100,terrainAheadFt:()=>-1000,nearRunwayFinal:false,gsDeviation:null,landingFlapWarning:false})
 expect(o.aural).not.toBe('TOO LOW, FLAPS')
})
it('reaches a deterministic trimmed stall near FM anchors at 525 kg and lighter holdout', async()=>{
 const {trim}=await import('../src/sim/trim')
 for(const mass of [525,440])for(const index of [0,2,5,6]){
  const a=new Aircraft(p);a.payloadKg=mass-p.emptyMassKg;a.resetFlaps(index)
  const t=trim({tasMs:32,altM:1000,massKg:mass,flapsDeg:a.flapsDeg,throttle:0,params:p})
  a.applyTrimState(32,t.alphaRad,1000,0,t.gammaRad,t.elevatorRad,0,t.rpm)
  let pitch=0,stall=0
  for(let i=0;i<14400;i++){
   const target=Math.max(-1,Math.min(1,pitch-.0001*a.data.verticalSpeedFpm/120-0.03*a.rates.y))
   pitch+=Math.max(-.4/120,Math.min(.4/120,target-pitch));a.controls.pitch=pitch;a.step(1/120)
   if(a.data.stallFraction>.5){stall=a.data.kias;break}
  }
  const nominal=(mass===525 ? {0:88,2:84,5:77,6:76} : {0:80,2:76,5:70,6:69})[index as 0|2|5|6]/1.852
  console.log('DG80 actual stall',mass,index,stall,'nominal',nominal,'end',a.data.kias,a.data.stallFraction,a.controls.pitch,a.controls.trim,a.data.verticalSpeedFpm)
  expect(stall).toBeGreaterThan(nominal-4.5);expect(stall).toBeLessThan(nominal+4.5)
 }
})
it('preserves legacy interpolation and bypasses mixing for representative other aircraft', async()=>{
 const {C172S}=await import('../src/sim/aircraft/c172s');const {B738}=await import('../src/sim/aircraft/b738');const {J3CUB}=await import('../src/sim/aircraft/j3cub')
 for(const q of [C172S,B738,J3CUB,rosterParams('AS21')!,rosterParams('LS8')!,rosterParams('DISC')!]){
  const a=new Aircraft(q);expect(a.controls.flapsIndex).toBe(0);a.applyTrimState(40,.03,1000,0,0,0,0,0);a.controls.roll=.4;a.step(1/120)
  expect(a.appliedControlSurfaces.aileronRad).toBe(.4*q.aileronMaxRad);expect(a.appliedControlSurfaces.flapsDeg).toBe(0)
  q.flapDetentsDeg.forEach((deg,i)=>expect(flapInterp(q.flapDClMax,deg,q.flapDetentsDeg)).toBe(q.flapDClMax[i]))
 }
 for(const [angle,expected] of [[-99,-9],[-7,-7],[-2,-2],[2,2],[99,13],[NaN,0],[Infinity,0],[-Infinity,0]])expect(flapInterp([-9,0,13],angle!,[-9,0,13])).toBe(expected)
 expect(flapInterp([7],NaN,[0])).toBe(7)
})


it('enforces the physical airbrake floor on every deployment, partial and redeployment tick', () => {
 for(const index of [0,2,4]) {
  const a=new Aircraft(p);a.resetFlaps(index);a.applyTrimState(30,.03,1000,0,0,0,0,0)
  let held=-9
  for(const [command,ticks] of [[.35,42],[0,18],[.8,96],[1,30],[0,120]]) {
   a.spoilerCmd=command!
   for(let i=0;i<ticks!;i++) {
    a.step(1/120);held=Math.max(held,-9+14*a.spoilerPos)
    expect(a.flapsDeg).toBeGreaterThanOrEqual(held-1e-10)
    expect(a.heldFlapFloorDeg).toBeCloseTo(held,10)
    expect(a.appliedControlSurfaces.flapsDeg).toBeCloseTo(a.flapsDeg,10)
    expect((a as unknown as {aeroIn:{flapsDeg:number}}).aeroIn.flapsDeg).toBeCloseTo(a.flapsDeg,10)
    if(index===4)expect(a.flapsDeg).toBe(10)
   }
  }
  a.selectFlaps(index);a.step(1/120)
  expect(a.heldFlapFloorDeg).toBe(-9)
  if(index===0)expect(a.flapsDeg).toBeCloseTo(5-8/120,10)
 }
})
it('keeps transient coupled actuator state invariant under timestep subdivision', () => {
 const a=new Aircraft(p),b=new Aircraft(p)
 for(const x of [a,b]){x.resetFlaps(0);x.applyTrimState(30,.03,1000,0,0,0,0,0)}
 for(const [command,ticks] of [[.35,42],[0,18],[.8,96],[1,30],[0,120]]) {
  a.spoilerCmd=b.spoilerCmd=command!
  for(let i=0;i<ticks!;i++) {
   a.step(1/120);b.step(1/240);b.step(1/240)
   expect(a.flapsDeg).toBeCloseTo(b.flapsDeg,10)
   expect(a.spoilerPos).toBeCloseTo(b.spoilerPos,10)
   expect(a.flapsDeg).toBeGreaterThanOrEqual(-9+14*a.spoilerPos-1e-10)
  }
 }
})
it('validates neutral metadata and keeps default spawn separate from invalid-input neutral', async () => {
 const {deriveParams}=await import('../src/sim/aircraft/derive');const {ROSTER}=await import('../src/sim/aircraft/roster')
 const entry=ROSTER.find(e=>e.spec.designator==='DG80')!
 expect(p.flapNeutralIndex).toBe(2)
 for(const neutral of [0,1,3,-1,7,.5,NaN])expect(()=>deriveParams({...entry.spec,tuning:{...entry.spec.tuning,flapNeutralIndex:neutral}},entry.opts)).toThrow()
 for(const index of [-1,7,.5,NaN])expect(()=>deriveParams({...entry.spec,tuning:{...entry.spec.tuning,flapDefaultIndex:index}},entry.opts)).toThrow()
 expect(()=>deriveParams({...entry.spec,tuning:{...entry.spec.tuning,flapNeutralIndex:undefined}},entry.opts)).toThrow()
 const distinct=deriveParams({...entry.spec,tuning:{...entry.spec.tuning,flapNeutralIndex:2,flapDefaultIndex:3}},entry.opts)
 const a=new Aircraft(distinct)
 expect(a.controls.flapsIndex).toBe(3);expect(a.flapsDeg).toBe(5)
 for(const invalid of [NaN,Infinity,-Infinity]){a.resetFlaps(invalid);expect(a.controls.flapsIndex).toBe(2);expect(a.flapsDeg).toBe(0)}
 a.selectFlaps(NaN);expect(a.controls.flapsIndex).toBe(2)
 a.spawnOnGround(0,0,0);expect(a.controls.flapsIndex).toBe(3);expect(a.flapsDeg).toBe(5);expect(a.appliedControlSurfaces.flapsDeg).toBeCloseTo(5,10)
 a.step(1/120);expect(a.flapsDeg).toBe(5)
})
