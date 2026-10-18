import { expect, it } from 'vitest'
import { TcasComputer } from '../src/sim/tcas'
import { TawsComputer, type TawsInput } from '../src/sim/taws'
const own = { altFt: 8000, aglFt: 8000, vsFpm: 0 }
const track = (id='a', n=1500, e=0, alt=8100) => ({id, relNorthM:n, relEastM:e, relVnMs:-120, relVeMs:0, altFt:alt, vsFpm:0})
it('TA outranks proximity in any input order',()=> {
 for (const ts of [[track('p',10000),track()], [track(),track('p',10000)]]) expect(new TcasComputer({taOnly:true}).step(1,own,ts).level).toBe('TA')
})
it('safe crossing miss does not generate an RA',()=>expect(new TcasComputer({taOnly:false}).step(1,own,[track('a',1500,1200)]).level).not.toBe('RA'))
it('TA alone never clears, RA removal clears even with remaining TA',()=>{
 const ta=new TcasComputer({taOnly:true});ta.step(1,own,[track()]);expect(ta.step(1,own,[]).level).not.toBe('CLEAR')
 const ra=new TcasComputer({taOnly:false});ra.step(1,own,[track()]);expect(ra.step(1,own,[track('b',4200)]).aural).toBe('CLEAR OF CONFLICT')
})
it('all TCAS speech inhibited below 500 AGL and descend becomes level-off below 1100',()=>{
 const c=new TcasComputer({taOnly:false});expect(c.step(1,own,[track()]).raSense).toBe('DESCEND')
 expect(c.step(1,{...own,aglFt:1050},[track('a',100)]).raSense).toBe('LEVEL_OFF')
 expect(c.step(1,{...own,aglFt:400},[track('a',100)]).aural).toBeUndefined()
})
it('multi intruder sense independent of input order',()=>{
 const ts=[track('far',1500,0,8100),track('close',200,0,7700)]
 expect(new TcasComputer({taOnly:false}).step(1,own,ts).raSense).toBe(new TcasComputer({taOnly:false}).step(1,own,ts.reverse()).raSense)
})
const base=(p:Partial<TawsInput>={}):TawsInput=>({aglFt:100,altFt:100,vsFpm:-300,gsKt:100,headingDeg:0,rollDeg:0,flapsDeg:30,sinceTakeoffS:600,terrainAheadFt:()=>0,nearRunwayFinal:true,gsDeviation:null,jetProfile:true,gearDown:true,...p})
it('spawn below gates never recites past gates',()=>{
 const c=new TawsComputer();for(let i=0;i<5;i++)expect(c.step(.5,base({aglFt:18})).aural).toBeUndefined()
})
it('large descending step speaks lowest crossed gate and no backlog or caution',()=>{
 const c=new TawsComputer();c.step(.5,base({aglFt:60}));const o=c.step(.5,base({aglFt:18}));expect(o.aural).toBe('TWENTY');expect(o.level).toBe('NONE');expect(c.step(.5,base({aglFt:18})).aural).toBeUndefined()
})
it('parked off-airport does not warn about terrain',()=>expect(new TawsComputer().step(.5,base({aglFt:6,gsKt:0,vsFpm:0,nearRunwayFinal:false})).aural).toBeUndefined())
it('ground suppresses TCAS alerts, reset forgets RA clearance',()=>{
 const c=new TcasComputer({taOnly:false});c.step(1,own,[track()]);c.reset();expect(c.step(1,own,[]).aural).toBeUndefined();expect(c.step(1,{...own,onGround:true},[track()]).level).toBe('PROX')
})
it('TAWS re-arms after go-around and reset does not create a crossing',()=>{
 const c=new TawsComputer();c.step(1,base({aglFt:70}));expect(c.step(1,base({aglFt:49})).aural).toBe('FIFTY');c.step(1,base({aglFt:80,vsFpm:500}));expect(c.step(1,base({aglFt:49})).aural).toBe('FIFTY');c.reset();expect(c.step(1,base({aglFt:40})).aural).toBeUndefined()
})
it('gear warning takes precedence over flaps on an unconfigured jet final',()=>expect(new TawsComputer().step(1,base({aglFt:180,flapsDeg:0,gearDown:false})).aural).toBe('TOO LOW, GEAR'))
it('takeoff phase inhibits premature landing configuration warning',()=>expect(new TawsComputer().step(1,base({aglFt:180,vsFpm:600,sinceTakeoffS:20,flapsDeg:0,gearDown:false})).aural).toBeUndefined())
it('low-altitude aural inhibit retains HUD advisory text',()=>{
 const o=new TcasComputer({taOnly:true}).step(1,{...own,aglFt:400},[track()]);expect(o.aural).toBeUndefined();expect(o.advisory).toBe('TRAFFIC, TRAFFIC')
})
it('RA scores commanded target rates, not changes added to the current climb/descent',()=>{
 for(const [vsFpm,dz,expected] of [[3000,100,'DESCEND'],[-3000,-100,'CLIMB']] as const){
  const out=new TcasComputer({taOnly:false}).step(1,{...own,vsFpm},[track('target',1800,0,own.altFt+dz)])
  expect(out.level).toBe('RA');expect(out.raSense).toBe(expected)
 }
})
