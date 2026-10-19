import {it,expect} from 'vitest'
import { ControllerRuntime } from '../src/input/controller-runtime'
import {tcaPresetFor,combineLevers} from '../src/sim/gamepad-map'
const id='TCA Q-Eng 1&2',m=tcaPresetFor([{id,index:1,axes:7}])!
const pads=(a=false,b=false)=>[{id,index:1,axes:[-1,-1],buttons:[{pressed:a},{pressed:b}]}]
it('both reverse lifts release symmetrically and focus/disconnect require release before rearm',()=>{
 const r=new ControllerRuntime();r.poll(m,pads(),true)
 expect(r.poll(m,pads(true,true),true).held('reverse2')).toBe(true)
 expect(r.poll(m,pads(true,false),true).held('reverse2')).toBe(false)
 expect(r.poll(m,pads(false,false),true).held('reverse')).toBe(false)
 r.poll(m,pads(true,true),false);expect(r.poll(m,pads(true,true),true).held('reverse')).toBe(false)
 r.poll(m,pads(),true);expect(r.poll(m,pads(true),true).held('reverse')).toBe(true)
 r.poll(m,[],true);expect(r.poll(m,pads(true),true).held('reverse')).toBe(false)
})
it('idle reverse lift cannot turn the other forward lever into reverse thrust',()=>{
 expect(combineLevers([{power:0,reverse:true},{power:1,reverse:false}])).toEqual({power:0,reverse:false,mixed:true})
})
