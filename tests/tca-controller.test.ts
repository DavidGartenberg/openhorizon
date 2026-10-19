import { describe,it,expect } from 'vitest'
import { tcaPresetFor, leverWithReverse, detectMovedAxis, detectPressedButton, parseGamepadMap, readAxis, readButton, mergePreset, combineLevers, type GamepadMap } from '../src/sim/gamepad-map'
const id='TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)'
const pad=(index=1,axes=[-1,-1],device=id)=>({id:device,index,connected:true,axes,buttons:[{pressed:false},{pressed:false}]})
describe('Captain controls safety',()=>{
 it('retains measured idle polarity, two held reverse lifts and no generic Thrustmaster preset',()=>{
  const m=tcaPresetFor([{id,index:1,axes:7}])!
  expect(m.throttle?.sign).toBe(1);expect(m.btn?.reverse2?.btn).toBe(1);expect(m.btnKeys?.['1:1']).toBeUndefined()
  expect(tcaPresetFor([{id:'Thrustmaster HOTAS',index:0,axes:7}])).toBeNull()
 })
 it('reads by identity after index move, rejects replacement/missing/nonfinite axes',()=>{
  const m=tcaPresetFor([{id,index:1,axes:7}])!
  expect(readAxis(m,'throttle',[pad(3,[-1,1])])).toBe(-1)
  expect(readAxis(m,'throttle',[pad(1,[0,0],'Xbox')])).toBeNull()
  expect(readAxis(m,'throttle',[pad(1,[])])).toBeNull()
  expect(readAxis(m,'throttle',[pad(1,[NaN])])).toBeNull()
  expect(readButton(m,'reverse2',[{...pad(3),buttons:[{pressed:false},{pressed:true}]}])).toBe(true)
  expect(readButton(m,'reverse2',[])).toBeNull()
 })
 it('calibrated reverse fits physical [-1,1], forward/reverse interpreted separately',()=>{
  const cal={min:-1,max:1,idle:-.5}
  expect(leverWithReverse(-1,cal)).toEqual({power:1,reverse:true})
  expect(leverWithReverse(-.5,cal)).toEqual({power:0,reverse:false})
  expect(leverWithReverse(1,cal)).toEqual({power:1,reverse:false})
  expect(combineLevers([{power:1,reverse:true},{power:1,reverse:false}])).toEqual({power:0,reverse:false,mixed:true})
  expect(combineLevers([{power:.8,reverse:true},{power:.4,reverse:true}]).power).toBeCloseTo(.6)
 })
 it('never captures new/resting/nonfinite axes or buttons',()=>{
  expect(detectMovedAxis([[]],[[-1]])).toBeNull()
  expect(detectMovedAxis([[0]],[[NaN]])).toBeNull()
  expect(detectPressedButton([],[[true]])).toBeNull()
  expect(detectPressedButton([[]],[[true]])).toBeNull()
 })
 it('validates enums indices and calibration; preserves calibrated migration',()=>{
  for(const raw of [{pitch:{pad:-1,axis:0,sign:1}},{bogus:{pad:0,axis:0,sign:1}},{btn:{bogus:{pad:0,btn:0}}},{throttle:{pad:0,axis:0,sign:1,calibration:{min:1,max:-1,idle:0}}},{btnKeys:{'0:NaN':'KeyZ'}}]) expect(parseGamepadMap(JSON.stringify(raw))).toBeNull()
  const old:GamepadMap={v:6,throttle:{pad:1,axis:0,sign:1,calibration:{min:-1,max:.9,idle:-.6}}}
  const migrated=mergePreset(old,tcaPresetFor([{id,index:1,axes:7}])!)
  expect(migrated.throttle?.calibration).toEqual(old.throttle?.calibration)
  expect(readAxis(migrated,'throttle',[pad(2)])).toBe(-1)
 })
})

import { ControllerCapture } from '../src/input/controller-capture'
it('capture requires explicit endpoints/idle, ignores replaced devices and does not timeout',()=>{
 const c=new ControllerCapture('axis','throttle',[pad()])
 c.poll([pad(1,[1,1],'unrelated')]);expect(c.candidate).toBeNull()
 c.poll([pad(1,[1,-1])]);expect(c.candidate).not.toBeNull();expect(c.result()).toBeNull()
 c.record('max',[pad(1,[1,-1])]);c.record('min',[pad(1,[-1,-1])]);expect(c.result()).toBeNull()
 c.record('idle',[pad(1,[-.5,-1])]);expect((c.result() as {calibration:unknown}).calibration).toEqual({min:-1,max:1,idle:-.5})
})
it('reconnect with swapped indices keeps aliases on the original device identity',()=>{
 const stick='TCA Sidestick X Copilot'
 const saved=tcaPresetFor([{id:stick,index:0,axes:10},{id,index:1,axes:7}])!
 const moved=mergePreset(saved,tcaPresetFor([{id:stick,index:1,axes:10},{id,index:0,axes:7}])!)
 expect(moved.devices?.['0']).toBe(stick)
 expect(moved.btnKeys?.['1:4']).toBeUndefined()
 expect(moved.btn?.reverse2?.deviceId).toBe(id)
})
it('initial held capture button must release and press, rather than bind at rest',()=>{
 const held={...pad(),buttons:[{pressed:true},{pressed:false}]}
 const c=new ControllerCapture('button','parkingBrake',[held])
 c.poll([held]);expect(c.candidate).toBeNull()
 c.poll([pad()]);c.poll([held]);expect(c.result()).toMatchObject({btn:0,deviceId:id})
})
it('a later quadrant replaces only the automatic stick slider, and captured buttons keep one action',()=>{
 const stick='TCA Sidestick X Copilot'
 const first=tcaPresetFor([{id:stick,index:0,axes:10}])!
 const both=tcaPresetFor([{id:stick,index:0,axes:10},{id,index:1,axes:7}])!
 expect(mergePreset(first,both).throttle?.deviceId).toBe(id)
 const custom={...first,throttle:{...first.throttle!,source:'user' as const}}
 expect(mergePreset(custom,both).throttle?.deviceId).toBe(stick)
 const captured={...both,btn:{parkingBrake:{pad:1,btn:0,deviceId:id}}}
 expect(mergePreset(captured,both).btn?.reverse).toBeUndefined()
})
it('retains unverified legacy custom bindings without assigning them to a newly seen device',()=>{
 const migrated=mergePreset({flaps:{pad:1,axis:2,sign:1}},tcaPresetFor([{id,index:1,axes:7}])!)
 expect(migrated.flaps).toBeDefined()
 expect(readAxis(migrated,'flaps',[pad(1,[-1,-1,1])])).toBeNull()
})

import {readAlias,serializeGamepadMap} from '../src/sim/gamepad-map'
it('quarantines unknown legacy aliases instead of authorizing them with a new device identity',()=>{
 const stick='TCA Sidestick X Copilot'
 const preset=tcaPresetFor([{id:stick,index:0,axes:10}])!
 const migrated=mergePreset({v:6,btnKeys:{'0:16':'KeyW','0:0':'KeyT'}},preset)
 const live={id:stick,index:0,axes:Array(10).fill(0),buttons:Array.from({length:20},(_,i)=>({pressed:i===16}))}
 expect(readAlias(migrated,'0:16',[live])).toBeNull()
 expect(migrated.btnKeys?.['0:16']).toBeUndefined()
 expect(migrated.unverifiedBtnKeys?.['0:16']).toBe('KeyW')
 expect(readAlias(migrated,'0:0',[live])).toBe(false)
 const reloaded=parseGamepadMap(serializeGamepadMap(migrated))!
 expect(mergePreset(reloaded,preset).unverifiedBtnKeys?.['0:16']).toBe('KeyW')
 expect(readAlias(mergePreset(reloaded,preset),'0:16',[live])).toBeNull()
})
it('retains custom aliases with existing device identity through index remapping',()=>{
 const stick='TCA Sidestick X Copilot'
 const saved:GamepadMap={v:7,devices:{'0':stick},btnKeys:{'0:17':'KeyB'}}
 const moved=mergePreset(saved,tcaPresetFor([{id:stick,index:3,axes:10}])!)
 const live={id:stick,index:3,axes:Array(10).fill(0),buttons:Array.from({length:20},(_,i)=>({pressed:i===17}))}
 expect(moved.btnKeys?.['0:17']).toBe('KeyB')
 expect(readAlias(moved,'0:17',[live])).toBe(true)
 expect(readAlias(moved,'0:17',[{...live,id:'Unrelated'}])).toBeNull()
})
it('captures real WebIDL gamepad axes and buttons whose fields are prototype getters',()=>{
 let axis=-.5,pressed=true
 class NativeButton {get pressed(){return pressed}}
 class NativePad {
  get id(){return 'Native controller'}
  get index(){return 2}
  get connected(){return true}
  get axes(){return [axis]}
  get buttons(){return [new NativeButton()]}
 }
 const native=new NativePad()
 expect(Object.keys(native)).toEqual([])
 const axisCapture=new ControllerCapture('axis','throttle',[native])
 axis=1;axisCapture.poll([native])
 expect(axisCapture.candidate).toMatchObject({pad:2,axis:0,sign:1,deviceId:'Native controller'})
 const buttonCapture=new ControllerCapture('button','ptt',[native])
 buttonCapture.poll([native]);expect(buttonCapture.candidate).toBeNull()
 pressed=false;buttonCapture.poll([native]);pressed=true;buttonCapture.poll([native])
 expect(buttonCapture.result()).toMatchObject({pad:2,btn:0,deviceId:'Native controller'})
})
