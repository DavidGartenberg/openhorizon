import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {it,expect} from 'vitest'
import * as mapping from '../src/sim/gamepad-map'
import {ControllerRuntime} from '../src/input/controller-runtime'
import {armSpeedbrake,cycleSpeedbrake} from '../src/input/speedbrake-control'
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8')
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true)
const body=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['pollControls','joyRead','shapeAxis'].includes(n.name?.text??'')).map(n=>n.getText(ast)).join('\n')
function harness(){
 // Levers rest at the IDLE detent, a quarter of the way up their travel: everything below it is reverse.
 const pad={id:'TCA Q-Eng 1&2',index:1,connected:true,axes:[-.5,-.5,-1,-1],buttons:Array.from({length:8},()=>({pressed:false}))}
 const m=mapping.tcaPresetFor([{id:pad.id,index:1,axes:7}])!
 m.flaps={pad:1,deviceId:pad.id,axis:2,sign:1};m.speedbrake={pad:1,deviceId:pad.id,axis:3,sign:1}
 m.btn={...m.btn,parkingBrake:{pad:1,deviceId:pad.id,btn:2},engineMaster1:{pad:1,deviceId:pad.id,btn:3},engineMaster2:{pad:1,deviceId:pad.id,btn:4}}
 const controls={pitch:0,roll:0,yaw:0,throttle:0,trim:0,mixture:1,flapsIndex:0,brakeLeft:0,brakeRight:0}
 const aircraft={controls,selectFlaps(index:number){controls.flapsIndex=index},P:{reversers:{},spoilers:{groundAutoDeploy:true},flapDetentsDeg:[0,1,2,3,4],gearRetractable:{}},data:{onGround:true},rates:{z:0},reverseCmd:false,spoilerCmd:0,spoilerArmed:false}
 const presses=new Set<string>();const pads:typeof pad[]=[pad]
 const ctx={...mapping,armSpeedbrake,cycleSpeedbrake,aircraft,gamepadMap:m,navigator:{getGamepads:()=>pads},document:{hidden:false,hasFocus:()=>true},controllerPanel:{capturing:false},input:{enabled:true,axis:()=>0,isHeld:()=>false,wasPressed:(k:string)=>presses.has(k),setVirtualHeld:()=>{},injectPress:()=>{}},controllerRuntime:new ControllerRuntime(),clearControllerTransient:()=>{},toast:()=>{},performance:{now:()=>0},systemsControls:{apMaster:false}}
 const declarations=`let shaped={pitch:0,roll:0,yaw:0},parkingBrake=false,keyboardReverse=false,hardwareReverseOwned=false,pilotBrake=0,baroSetInHg=29.92,captainCommands={},assistMode='off',groundHeadingLockDeg=null,airbornePitchLockDeg=null,airborneHeadingLockDeg=null,scrubSeconds=0,autothrottle={engaged:false},atHwRef=NaN,gearLeverPrev=null;`
 const code=ts.transpileModule(declarations+body+';return ()=>{pollControls(.02);return {parkingBrake,captainCommands}}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const poll=new Function(...Object.keys(ctx),code)(...Object.values(ctx)) as ()=>{parkingBrake:boolean;captainCommands:Record<string,unknown>}
 return {pad,pads,aircraft,presses,poll,m,systemsControls:ctx.systemsControls as {apMaster:boolean}}
}
it('main applies flap/speedbrake axes, absolute parking brake and both master switch levels',()=>{
 const h=harness();h.poll();h.pad.axes=[-.5,-.5,1,0];h.pad.buttons[2]!.pressed=true;h.pad.buttons[3]!.pressed=true
 const s=h.poll();expect(h.aircraft.controls.flapsIndex).toBe(4);expect(h.aircraft.spoilerCmd).toBe(.5);expect(s.parkingBrake).toBe(true);expect(s.captainCommands).toMatchObject({engineMaster1:true,engineMaster2:false})
 h.pad.axes[0]=1;h.poll();expect(h.aircraft.controls.brakeLeft).toBe(1)
 h.pad.buttons[2]!.pressed=false;expect(h.poll().parkingBrake).toBe(false);expect(h.aircraft.controls.brakeLeft).toBe(0)
})
it('main releases either lift symmetrically, rejects opposing levers and preserves keyboard reverse without hardware ownership',()=>{
 const h=harness();h.poll();h.pad.buttons[0]!.pressed=true;h.pad.buttons[1]!.pressed=true;h.poll();expect(h.aircraft.reverseCmd).toBe(true)
 h.pad.buttons[0]!.pressed=false;h.poll();expect(h.aircraft.reverseCmd).toBe(true)
 h.pad.buttons[1]!.pressed=false;h.poll();expect(h.aircraft.reverseCmd).toBe(false)
 h.pad.buttons[0]!.pressed=true;h.pad.axes[1]=1;h.poll();expect(h.aircraft.controls.throttle).toBe(0);expect(h.aircraft.reverseCmd).toBe(false)
 h.pads.length=0;h.presses.add('KeyZ');h.poll();expect(h.aircraft.reverseCmd).toBe(true)
})

it('main cycles non-auto airbrakes directly DOWN/FULL and rejects their ARM binding',()=>{
 const h=harness();h.aircraft.P.spoilers.groundAutoDeploy=false;delete h.m.speedbrake
 h.presses.add('KeyV');h.poll();h.presses.delete('KeyV')
 expect(h.aircraft).toMatchObject({spoilerCmd:1,spoilerArmed:false})
 h.presses.add('KeyV');h.poll();h.presses.delete('KeyV')
 expect(h.aircraft).toMatchObject({spoilerCmd:0,spoilerArmed:false})
 h.m.btn={...h.m.btn,speedbrakeArm:{pad:1,deviceId:h.pad.id,btn:5}}
 h.pad.buttons[5]!.pressed=true;h.poll()
 expect(h.aircraft).toMatchObject({spoilerCmd:0,spoilerArmed:false})
})

it('main preserves the jet DOWN/ARM/FLIGHT keyboard cycle and ARM binding',()=>{
 const h=harness();h.aircraft.P.spoilers.groundAutoDeploy=true;delete h.m.speedbrake
 h.presses.add('KeyV');h.poll();h.presses.delete('KeyV')
 expect(h.aircraft).toMatchObject({spoilerCmd:0,spoilerArmed:true})
 h.presses.add('KeyV');h.poll();h.presses.delete('KeyV')
 expect(h.aircraft).toMatchObject({spoilerCmd:1,spoilerArmed:false})
 h.aircraft.spoilerCmd=0
 h.m.btn={...h.m.btn,speedbrakeArm:{pad:1,deviceId:h.pad.id,btn:5}}
 h.pad.buttons[5]!.pressed=true;h.poll()
 expect(h.aircraft).toMatchObject({spoilerCmd:0,spoilerArmed:true})
})

import {createCaptainSystems,stepCaptainSystems} from '../src/sim/captain-systems'
import {makeFuelState,stepFuel,negativeGToleranceS} from '../src/sim/systems/fuel'
import {Aircraft} from '../src/sim/aircraft'
import {B738} from '../src/sim/aircraft/b738'
it('first real systems tick reads fresh fuel metadata before Captain engine state',()=>{
 const aircraft=new Aircraft(B738);aircraft.posNed.z=-1000;aircraft.velBody.x=100
 const fuelState=makeFuelState(100,100)
 const start=Math.min(source.indexOf('      captainSystems=stepCaptainSystems'),source.indexOf('      stepFuel(fuelState, dt,'))
 const end=source.indexOf('      stepEngineStart(engineStartState, dt,',start)
 const ctx={aircraft,fuelState,stepFuel,negativeGToleranceS,toast:()=>{},stepCaptainSystems,createCaptainSystems,systemsControls:{masterBattery:true,fuelSelector:'BOTH',boostPumpOn:false}}
 const code=ts.transpileModule(`let captainSystems=createCaptainSystems(),captainCommands={},pilotBrake=0,dt=.02,negGCutAnnounced=false,autobrakeRequest=null,lastAutobrakePhase='off';${source.slice(start,end)};return captainSystems`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const state=new Function(...Object.keys(ctx),code)(...Object.values(ctx))
 expect(fuelState.fuelFlowing).toBe(true)
 expect(state.enginePowerFraction).toBe(1)
})

it('main reads the lower quarter of the quadrant as reverse thrust on the ground, and as idle in the air or without reversers',()=>{
 const h=harness();h.poll();expect(h.aircraft.reverseCmd).toBe(false)
 h.pad.axes[0]=h.pad.axes[1]=-.75;h.poll();expect(h.aircraft.reverseCmd).toBe(true);expect(h.aircraft.controls.throttle).toBeCloseTo(.5)
 h.pad.axes[0]=h.pad.axes[1]=-1;h.poll();expect(h.aircraft.controls.throttle).toBe(1)
 h.aircraft.data.onGround=false;h.poll();expect(h.aircraft.controls.throttle).toBe(0)
 h.aircraft.data.onGround=true;h.aircraft.P.reversers=undefined as never;h.poll();expect(h.aircraft.controls.throttle).toBe(0)
 h.aircraft.P.reversers={};h.pad.axes[0]=h.pad.axes[1]=-.5;h.poll();expect(h.aircraft.reverseCmd).toBe(false);expect(h.aircraft.controls.throttle).toBe(0)
 h.pad.axes[0]=h.pad.axes[1]=1;h.poll();expect(h.aircraft.controls.throttle).toBe(1)
})

it('the sidestick red button disengages the autopilot, and only that button does',()=>{
 const h=harness()
 const stick={id:'TCA Sidestick X Copilot (Vendor: 044f Product: 040f)',index:0,connected:true,axes:Array(10).fill(0),buttons:Array.from({length:22},()=>({pressed:false}))}
 h.pads.unshift(stick as never)
 const preset=mapping.tcaPresetFor([{id:stick.id,index:0,axes:10},{id:h.pad.id,index:1,axes:7}])!
 for(const k of Object.keys(h.m))delete (h.m as Record<string,unknown>)[k]
 Object.assign(h.m,preset)
 expect(preset.btn?.apDisconnect).toMatchObject({pad:0,btn:1,deviceId:stick.id})
 h.systemsControls.apMaster=true;h.poll()
 expect(h.systemsControls.apMaster).toBe(true)
 for(const other of [0,2,3,4,5,6,7,8,9,10]){stick.buttons[other]!.pressed=true}               // the trigger, thumb, hat and base buttons
 h.poll();expect(h.systemsControls.apMaster).toBe(true)
 for(const other of [0,2,3,4,5,6,7,8,9,10])stick.buttons[other]!.pressed=false
 h.poll();stick.buttons[1]!.pressed=true;h.poll()                                              // the red one
 expect(h.systemsControls.apMaster).toBe(false)
})

it('the gear lever is one switch: its button ON is gear UP and OFF is gear DOWN, acting when the lever moves',()=>{
 const h=harness();h.m.btn={...h.m.btn,gearLever:{pad:1,deviceId:h.pad.id,btn:6}}
 const gear=(h.aircraft as unknown as {gearDownCommanded:boolean})
 // airborne, the lever read for the first time is OFF: the gear goes down
 h.aircraft.data.onGround=false;gear.gearDownCommanded=false;h.poll();expect(gear.gearDownCommanded).toBe(true)
 h.pad.buttons[6]!.pressed=true;h.poll();expect(gear.gearDownCommanded).toBe(false)           // ON: up
 h.pad.buttons[6]!.pressed=false;h.poll();expect(gear.gearDownCommanded).toBe(true)            // OFF: down
 // the keyboard's toggle is not fought while the lever stays where it is
 gear.gearDownCommanded=false;h.poll();h.poll();expect(gear.gearDownCommanded).toBe(false)
})

it('the gear lever read for the first time on the ground only records where it is; moving it then acts',()=>{
 const h=harness();h.m.btn={...h.m.btn,gearLever:{pad:1,deviceId:h.pad.id,btn:6}}
 const gear=(h.aircraft as unknown as {gearDownCommanded:boolean})
 h.aircraft.data.onGround=true;gear.gearDownCommanded=true
 h.pad.buttons[6]!.pressed=true;h.poll();expect(gear.gearDownCommanded).toBe(true)             // lever UP (ON) at load: the gear is not retracted under the airplane
 h.pad.buttons[6]!.pressed=false;h.poll();expect(gear.gearDownCommanded).toBe(true)            // lever to DOWN: already down
 h.pad.buttons[6]!.pressed=true;h.poll();expect(gear.gearDownCommanded).toBe(false)            // lever raised: gear up
 h.pad.buttons[6]!.pressed=false;h.poll();expect(gear.gearDownCommanded).toBe(true)            // and lowered
})

it('separate GEAR UP / GEAR DOWN position buttons still act when pressed',()=>{
 const h=harness();h.m.btn={...h.m.btn,gearDown:{pad:1,deviceId:h.pad.id,btn:6},gearUp:{pad:1,deviceId:h.pad.id,btn:5}}
 const gear=(h.aircraft as unknown as {gearDownCommanded:boolean});gear.gearDownCommanded=true
 h.pad.buttons[5]!.pressed=true;h.poll();expect(gear.gearDownCommanded).toBe(false)
 h.pad.buttons[5]!.pressed=false;h.pad.buttons[6]!.pressed=true;h.poll();expect(gear.gearDownCommanded).toBe(true)
 h.pad.buttons[6]!.pressed=false;h.poll();expect(gear.gearDownCommanded).toBe(true)             // releasing a position button changes nothing
})
