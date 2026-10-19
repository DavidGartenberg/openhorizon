/** Executes the actual main restore/reset functions without constructing WebGL. */
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { TcasComputer } from '../src/sim/tcas'
import { TawsComputer, type TawsInput } from '../src/sim/taws'
import { SafetySpeechController } from '../src/audio/safety-speech'
import { applyLoading, loadingFromSnapshot } from '../src/sim/loading'
import { C172S } from '../src/sim/aircraft/c172s'
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8')
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true)
const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n) && ['loadSnapshot','resetFlightSafety'].includes(n.name?.text??'')).map(n=>n.getText(ast)).join('\n')
it('airborne snapshot discards old warnings, gate history, takeoff phase and pending speech',()=>{
 const tcas=new TcasComputer({taOnly:false}),taws=new TawsComputer()
 const own={altFt:8000,aglFt:8000,vsFpm:0}
 tcas.step(1,own,[{id:'old',relNorthM:1000,relEastM:0,relVnMs:-100,relVeMs:0,altFt:8100,vsFpm:0}])
 const approach:TawsInput={aglFt:600,altFt:600,vsFpm:-300,gsKt:100,headingDeg:0,rollDeg:0,flapsDeg:30,sinceTakeoffS:600,terrainAheadFt:()=>0,nearRunwayFinal:true,gsDeviation:null}
 taws.step(1,approach)
 const spoken:string[]=[],ends:Array<()=>void>=[]
 const safetySpeech=new SafetySpeechController({cancel:()=>{},speak:(m,end)=>{spoken.push(m.text);ends.push(end)}})
 safetySpeech.radio('old radio',0);safetySpeech.radio('queued old radio',1)
 let cancelledTimers=0
 const noop=()=>{}
 const ctx={tcas,taws,safetySpeech,localStorage:{getItem:()=>JSON.stringify({v:1,onGround:false,lat:1,lon:1,altFt:3000,kias:100,flapsIndex:0,fuelKg:100,payloadKg:100,hdgDeg:0,simMs:0,spawn:'saved'})},
 toast:noop,aircraft:{P:{...C172S,flapDetentsDeg:[0]},controls:{},posNed:{x:0,y:0},massKg:1000,resetFlaps:noop,applyTrimState:noop},resetSystemsState:noop,frame:{anchor:{}},tiles:{onRebase:noop,update:noop},airports:{positionAll:noop,updateVisuals:noop},
 FLEET_ACTIVE:{params:C172S},loadingFromSnapshot,applyLoading,
 FT:.3048,KT:.514444,kcasFromKias:(n:number)=>n,isa:()=>({densityKgM3:1.225}),trim:()=>({alphaRad:0,gammaRad:0,elevatorRad:0,throttle:0,rpm:0}),fuelState:{},baseDate:new Date(0),loop:{simTime:0},makeCopilotLatches:()=>({}),cancelAtcTimers:()=>{cancelledTimers++}}
 const declarations=`let liftoffSimS=99,safetyWasGrounded=true,lastSafetyAt=0,safetyLine='old',trafficDots=[1],copilotLine='old',copilotUntil=999,copilotLatches={},copilotPrev={},parkingBrake=true,spawnDesc='',scrubSeconds=0,lastTcasDebug={level:'RA',trackLevels:['old']},flightVoiceEpoch=0,voicePtt=undefined;`
 const code=ts.transpileModule(declarations+functions+`; return {ok:loadSnapshot(), phase:()=>({liftoffSimS,safetyWasGrounded,lastSafetyAt,safetyLine,copilotLine,copilotPrev})};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const loaded=new Function(...Object.keys(ctx),code)(...Object.values(ctx))
 expect(loaded.ok).toBe(true)
 expect(tcas.step(1,own,[]).aural).toBeUndefined()
 expect(taws.step(1,{...approach,aglFt:400}).aural).toBeUndefined()
 safetySpeech.update(500);ends[0]!();safetySpeech.radio('new radio',501)
 expect(spoken).toEqual(['old radio','new radio'])
 expect(loaded.phase()).toEqual({liftoffSimS:null,safetyWasGrounded:false,lastSafetyAt:-Infinity,safetyLine:'',copilotLine:'',copilotPrev:null})
 expect(cancelledTimers).toBe(1)
})
