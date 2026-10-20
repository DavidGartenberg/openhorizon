/** Executes main's real input/save functions with a real Aircraft, without WebGL. */
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {expect,it} from 'vitest'
import {Aircraft} from '../src/sim/aircraft'
import {rosterParams} from '../src/sim/aircraft/roster'
import * as mapping from '../src/sim/gamepad-map'
import * as flaperons from '../src/sim/flaperons'
import {ControllerRuntime} from '../src/input/controller-runtime'
import {armSpeedbrake,cycleSpeedbrake} from '../src/input/speedbrake-control'
import {applyLoading,loadingFromSnapshot} from '../src/sim/loading'
import {makeFuelState} from '../src/sim/systems/fuel'
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8')
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true)
const names=['pollControls','joyRead','shapeAxis','handleDiscreteKeys','loadSnapshot','saveSnapshot','updateControllers','spawnAtAirport','clearControllerTransient']
const body=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast)).join('\n')
function harness(params=rosterParams('DG80')!){
 const aircraft=new Aircraft(params)
 const pad={id:'DG80 test quadrant',index:0,connected:true,axes:[-1],buttons:Array.from({length:8},()=>({pressed:false}))}
 const map:mapping.GamepadMap={btn:{}} as mapping.GamepadMap
 const keys=new Set<string>(),messages:string[]=[]
 let stored:Record<string,unknown>|null=null,diagnostic='',trimAngle=NaN
 const noop=()=>{}
 const ctx={...mapping,...flaperons,aircraft,gamepadMap:map,navigator:{getGamepads:()=>pad.connected?[pad]:[]},document:{hidden:false,hasFocus:()=>true},
 controllerPanel:{capturing:false,update:(_p:unknown,s:string)=>{diagnostic=s}},input:{enabled:true,axis:()=>0,isHeld:()=>false,wasPressed:(k:string)=>keys.has(k),setVirtualHeld:noop,injectPress:noop},
 controllerRuntime:new ControllerRuntime(),toast:(s:string)=>messages.push(s),performance:{now:()=>0},systemsControls:{apMaster:false},armSpeedbrake,cycleSpeedbrake,
 loop:{paused:true,simTime:0},physicalPttState:()=>false,saveJoyMap:noop,
 localStorage:{getItem:()=>JSON.stringify(stored),setItem:(_k:string,s:string)=>{stored=JSON.parse(s)}},
 loadingFromSnapshot,applyLoading,FLEET_ACTIVE:{params:aircraft.P,final:{kias:60,flapsIndex:5,flapsDeg:13}},fleetKey:'DG80',resetSystemsState:noop,resetFlightSafety:noop,
 recorder:{reset:noop},pickRunway:()=>({fromHigh:false,r:{la1:1,lo1:1,e1:0,la2:1.1,lo2:1,e2:0}}),bearingDeg:()=>0,setDaytimeAt:noop,
 frame:{anchor:{},toLocal:()=>({n:0,e:0}),fromLocal:()=>({lat:1,lon:1})},tiles:{onRebase:noop,update:noop},airports:{find:()=>null,positionAll:noop,updateVisuals:noop,near:()=>[]},
 FT:.3048,KT:.5144444444444445,kcasFromKias:(n:number)=>n,isa:()=>({densityKgM3:1.225}),
 trim:(o:{flapsDeg:number})=>{trimAngle=o.flapsDeg;return {alphaRad:0,gammaRad:0,elevatorRad:0,throttle:0,rpm:0}},fuelState:makeFuelState(0,0),baseDate:new Date(0)}
 const declarations=`let flightStartSimS=null,lastOnGround=true,debriefLine='',shaped={pitch:0,roll:0,yaw:0},parkingBrake=false,keyboardReverse=false,hardwareReverseOwned=false,pilotBrake=0,baroSetInHg=29.92,captainCommands={},assistMode='off',groundHeadingLockDeg=null,airbornePitchLockDeg=null,airborneHeadingLockDeg=null,scrubSeconds=0,atcMenuOpen=false,activeAtc=null,spawnDesc='',ctlOverride=null,voicePtt=undefined,lastPadIdentity='DG80 test quadrant:0:1:8',captainSystems={engine1Running:false,engine2Running:false,rudderTrim:0};`
 const code=ts.transpileModule(declarations+body+';return {poll:()=>pollControls(.02),key:handleDiscreteKeys,load:loadSnapshot,save:saveSnapshot,diagnostics:updateControllers,spawn:spawnAtAirport}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const run=new Function(...Object.keys(ctx),code)(...Object.values(ctx))
 return {aircraft,pad,map,keys,messages,run,document:ctx.document,get diagnostic(){return diagnostic},get stored(){return stored},get trimAngle(){return trimAngle},snapshot:(s:Record<string,unknown>)=>{stored={v:1,onGround:false,lat:1,lon:1,altFt:3000,kias:70,flapsIndex:0,fuelKg:0,payloadKg:80,hdgDeg:0,simMs:0,spawn:'saved',...s}}}
}
it('keyboard F/G reaches all seven signed settings and R resets to neutral',()=>{
 const h=harness();h.aircraft.resetFlaps(0)
 h.keys.add('KeyF');for(let i=1;i<7;i++){h.run.key();expect(h.aircraft.controls.flapsIndex).toBe(i)}
 h.keys.clear();h.keys.add('KeyG');for(let i=5;i>=0;i--){h.run.key();expect(h.aircraft.controls.flapsIndex).toBe(i)}
 h.keys.clear();h.keys.add('KeyR');h.run.key();expect(h.aircraft.controls.flapsIndex).toBe(2);expect(h.aircraft.flapsDeg).toBe(0)
})
it('five-position quadrant maps to the documented signed subset',()=>{
 const h=harness();const functions=['flaps0','flaps1','flaps2','flaps3','flapsFull'] as const
 for(const [i,fn]of functions.entries())h.map.btn![fn]={pad:0,deviceId:h.pad.id,btn:i}
 for(const [i,expected]of [0,2,3,5,6].entries()){h.pad.buttons.forEach((b,j)=>b.pressed=j===i);h.run.poll();expect(h.aircraft.controls.flapsIndex).toBe(expected)}
})
it('analog flap axis reaches every setting without releasing an airbrake displacement on steady polling',()=>{
 const h=harness();h.map.flaps={pad:0,deviceId:h.pad.id,axis:0,sign:1}
 for(let i=0;i<7;i++){h.pad.axes[0]=-1+i/3;h.run.poll();expect(h.aircraft.controls.flapsIndex).toBe(i)}
 h.pad.axes[0]=-1;h.run.poll();h.aircraft.heldFlapFloorDeg=5;h.aircraft.flapsDeg=5;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(5)
 h.pad.axes[0]=0;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(-9)
})
it('keyboard deliberate selection releases held linkage',()=>{
 const h=harness();h.aircraft.resetFlaps(0);h.aircraft.heldFlapFloorDeg=5
 h.keys.add('KeyF');h.run.key();expect(h.aircraft.heldFlapFloorDeg).toBe(-9)
})
it('legacy DG80 index zero restores neutral and trims the same physical angle',()=>{
 const h=harness();h.snapshot({});expect(h.run.load()).toBe(true)
 expect(h.aircraft.controls.flapsIndex).toBe(2);expect(h.aircraft.flapsDeg).toBe(0);expect(h.trimAngle).toBe(0)
})
it('rejects foreign snapshots before changing aircraft loading or flaps',()=>{
 const h=harness();h.aircraft.resetFlaps(4);const payload=h.aircraft.payloadKg
 h.snapshot({aircraftId:'737',flapSchema:1,flapCommandDeg:30,payloadKg:120})
 expect(h.run.load()).toBe(false);expect(h.aircraft.controls.flapsIndex).toBe(4);expect(h.aircraft.payloadKg).toBe(payload)
})
it('saves commanded physical angle and restores it independently of an obsolete index',()=>{
 const h=harness();h.aircraft.resetFlaps(0);h.aircraft.heldFlapFloorDeg=5;h.aircraft.flapsDeg=5;h.run.save()
 expect(h.stored).toMatchObject({aircraftId:'DG80',flapSchema:1,flapCommandDeg:-9})
 h.snapshot({...h.stored,onGround:false,flapsIndex:6});expect(h.run.load()).toBe(true)
 expect(h.aircraft.controls.flapsIndex).toBe(0);expect(h.aircraft.flapsDeg).toBe(-9);expect(h.aircraft.heldFlapFloorDeg).toBe(-9);expect(h.trimAngle).toBe(-9)
})
it('controller diagnostics distinguish the signed selection, constrained angle and five physical positions',()=>{
 const h=harness();h.aircraft.resetFlaps(0);h.aircraft.flapsDeg=5;h.run.diagnostics()
 expect(h.diagnostic).toContain('-9');expect(h.diagnostic).toContain('5');expect(h.diagnostic).toContain('all 7');expect(h.diagnostic).toContain('L')
})
it('hardware step buttons reach all detents and release held linkage on a fresh press',()=>{
 const h=harness();h.map.btn={flapsDown:{pad:0,deviceId:h.pad.id,btn:6},flapsUp:{pad:0,deviceId:h.pad.id,btn:7}}
 h.aircraft.resetFlaps(0);h.run.poll()
 for(let i=1;i<7;i++){h.aircraft.heldFlapFloorDeg=5;h.pad.buttons[6]!.pressed=true;h.run.poll();expect(h.aircraft.controls.flapsIndex).toBe(i);expect(h.aircraft.heldFlapFloorDeg).toBe(-9);h.pad.buttons[6]!.pressed=false;h.run.poll()}
 for(let i=5;i>=0;i--){h.pad.buttons[7]!.pressed=true;h.run.poll();expect(h.aircraft.controls.flapsIndex).toBe(i);h.pad.buttons[7]!.pressed=false;h.run.poll()}
})
it('unpowered aircraft diagnostics do not imply running engines or ignition',()=>{
 const h=harness();h.run.diagnostics();expect(h.diagnostic).toContain('UNPOWERED');expect(h.diagnostic).not.toMatch(/Engines.*(?:RUN|STOP)/)
})
it('nonfinite serialized commanded angle restores finite neutral state',()=>{
 const h=harness();h.snapshot({aircraftId:'DG80',flapSchema:1,flapCommandDeg:null,flapsIndex:6});expect(h.run.load()).toBe(true)
 expect(h.aircraft.controls.flapsIndex).toBe(2);expect(h.aircraft.flapsDeg).toBe(0);expect(h.trimAngle).toBe(0)
})
it('trimmed airborne restoration resets actual airbrake linkage before the next physics tick',()=>{
 const h=harness();h.aircraft.spoilerPos=1;h.aircraft.spoilerCmd=1;h.aircraft.heldFlapFloorDeg=5
 h.snapshot({aircraftId:'DG80',flapSchema:1,flapCommandDeg:-9});expect(h.run.load()).toBe(true)
 expect(h.aircraft.spoilerPos).toBe(0);expect(h.aircraft.spoilerCmd).toBe(0)
 h.aircraft.step(1/120);expect(h.aircraft.flapsDeg).toBe(-9);expect(h.aircraft.heldFlapFloorDeg).toBe(-9)
})

it('ground and final airport spawns initialize coherent signed control state',()=>{
 const h=harness();const airport={i:'TEST',la:1,lo:1}
 h.aircraft.resetFlaps(0);h.aircraft.spoilerPos=1;h.aircraft.spoilerCmd=1;h.aircraft.heldFlapFloorDeg=5
 h.run.spawn(airport,'01',false);expect(h.aircraft.controls.flapsIndex).toBe(2);expect(h.aircraft.flapsDeg).toBe(0);expect(h.aircraft.spoilerPos).toBe(0)
 h.aircraft.spoilerPos=1;h.aircraft.spoilerCmd=1;h.aircraft.heldFlapFloorDeg=5
 h.run.spawn(airport,'01',true);expect(h.aircraft.controls.flapsIndex).toBe(5);expect(h.aircraft.flapsDeg).toBe(13);expect(h.trimAngle).toBe(13);expect(h.aircraft.spoilerPos).toBe(0);expect(h.aircraft.heldFlapFloorDeg).toBe(-9)
 h.aircraft.step(1/120);expect(h.aircraft.appliedControlSurfaces.flapsDeg).toBeCloseTo(13,10)
})
it('invalid flight state rejects before mutating valid aircraft state',()=>{
 const h=harness();h.aircraft.resetFlaps(4);const payload=h.aircraft.payloadKg
 h.snapshot({aircraftId:'DG80',altFt:null,payloadKg:80});expect(h.run.load()).toBe(false)
 expect(h.aircraft.payloadKg).toBe(payload);expect(h.aircraft.controls.flapsIndex).toBe(4)
})

it('a fresh same-position button press releases linkage while steady, reconnect and focus polls preserve it',()=>{
 const h=harness();h.map.btn={flaps0:{pad:0,deviceId:h.pad.id,btn:0}}
 h.aircraft.resetFlaps(0);h.run.poll();h.pad.buttons[0]!.pressed=true;h.run.poll()
 const displace=()=>{h.aircraft.heldFlapFloorDeg=5;h.aircraft.flapsDeg=5}
 displace();h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(5)
 h.pad.buttons[0]!.pressed=false;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(5)
 h.pad.buttons[0]!.pressed=true;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(-9)
 displace();h.pad.connected=false;h.run.poll();h.pad.connected=true;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(5)
 h.pad.buttons[0]!.pressed=false;h.run.poll();h.pad.buttons[0]!.pressed=true;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(-9)
 displace();h.document.hasFocus=()=>false;h.run.poll();h.document.hasFocus=()=>true;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(5)
 h.pad.buttons[0]!.pressed=false;h.run.poll();h.pad.buttons[0]!.pressed=true;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(-9)
 // A deliberate press still respects the currently extended airbrakes.
 displace();h.aircraft.spoilerPos=.5;h.pad.buttons[0]!.pressed=false;h.run.poll();h.pad.buttons[0]!.pressed=true;h.run.poll();expect(h.aircraft.heldFlapFloorDeg).toBe(-2)
})
it('invalid physical snapshot falls back to neutral even when spawn default differs',()=>{
 const h=harness({...rosterParams('DG80')!,flapNeutralIndex:2,flapDefaultIndex:3})
 expect(h.aircraft.controls.flapsIndex).toBe(3)
 for(const angle of [null,999]){h.snapshot({aircraftId:'DG80',flapSchema:1,flapCommandDeg:angle});expect(h.run.load()).toBe(true);expect(h.aircraft.controls.flapsIndex).toBe(2);expect(h.trimAngle).toBe(0)}
})
