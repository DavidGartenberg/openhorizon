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
 const pad={id:'TCA Q-Eng 1&2',index:1,connected:true,axes:[-1,-1,-1,-1],buttons:Array.from({length:8},()=>({pressed:false}))}
 const m=mapping.tcaPresetFor([{id:pad.id,index:1,axes:7}])!
 m.flaps={pad:1,deviceId:pad.id,axis:2,sign:1};m.speedbrake={pad:1,deviceId:pad.id,axis:3,sign:1}
 m.btn={...m.btn,parkingBrake:{pad:1,deviceId:pad.id,btn:2},engineMaster1:{pad:1,deviceId:pad.id,btn:3},engineMaster2:{pad:1,deviceId:pad.id,btn:4}}
 const controls={pitch:0,roll:0,yaw:0,throttle:0,trim:0,mixture:1,flapsIndex:0,brakeLeft:0,brakeRight:0}
 const aircraft={controls,selectFlaps(index:number){controls.flapsIndex=index},P:{reversers:{},spoilers:{groundAutoDeploy:true},flapDetentsDeg:[0,1,2,3,4],gearRetractable:{}},data:{onGround:true},rates:{z:0},reverseCmd:false,spoilerCmd:0,spoilerArmed:false}
 const presses=new Set<string>();const pads:typeof pad[]=[pad]
 const ctx={...mapping,armSpeedbrake,cycleSpeedbrake,aircraft,gamepadMap:m,navigator:{getGamepads:()=>pads},document:{hidden:false,hasFocus:()=>true},controllerPanel:{capturing:false},input:{enabled:true,axis:()=>0,isHeld:()=>false,wasPressed:(k:string)=>presses.has(k),setVirtualHeld:()=>{},injectPress:()=>{}},controllerRuntime:new ControllerRuntime(),clearControllerTransient:()=>{},toast:()=>{},performance:{now:()=>0},systemsControls:{apMaster:false}}
 const declarations=`let shaped={pitch:0,roll:0,yaw:0},parkingBrake=false,keyboardReverse=false,hardwareReverseOwned=false,pilotBrake=0,baroSetInHg=29.92,captainCommands={},assistMode='off',groundHeadingLockDeg=null,airbornePitchLockDeg=null,airborneHeadingLockDeg=null,scrubSeconds=0,autothrottle={engaged:false},atHwRef=NaN;`
 const code=ts.transpileModule(declarations+body+';return ()=>{pollControls(.02);return {parkingBrake,captainCommands}}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const poll=new Function(...Object.keys(ctx),code)(...Object.values(ctx)) as ()=>{parkingBrake:boolean;captainCommands:Record<string,unknown>}
 return {pad,pads,aircraft,presses,poll,m}
}
it('main applies flap/speedbrake axes, absolute parking brake and both master switch levels',()=>{
 const h=harness();h.poll();h.pad.axes=[-1,-1,1,0];h.pad.buttons[2]!.pressed=true;h.pad.buttons[3]!.pressed=true
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
 const code=ts.transpileModule(`let captainSystems=createCaptainSystems(),captainCommands={},pilotBrake=0,dt=.02,negGCutAnnounced=false;${source.slice(start,end)};return captainSystems`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const state=new Function(...Object.keys(ctx),code)(...Object.values(ctx))
 expect(fuelState.fuelFlowing).toBe(true)
 expect(state.enginePowerFraction).toBe(1)
})
