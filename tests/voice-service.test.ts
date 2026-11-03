import {describe,it,expect} from 'vitest'
import {Readable} from 'node:stream'
import {EventEmitter} from 'node:events'
import fs from 'node:fs/promises'
// @ts-expect-error server ESM
import {createVoiceService, validateWav, runCommand} from '../server/voice.mjs'

const fixture = new URL('./browser/fixtures/atc-phrase.wav',import.meta.url)
async function request(service:any,path:string,body:Buffer=Buffer.alloc(0),options:any={}) {
  const req=Readable.from([body]) as any
  req.method=options.method??'POST';req.headers={host:'localhost:5173',origin:'http://localhost:5173','content-type':options.type??'audio/wav',...options.headers};req.socket={remoteAddress:options.remote??'127.0.0.1'}
  const res=new EventEmitter() as any;res.headers={};res.setHeader=(k:string,v:string)=>res.headers[k]=v;res.removeHeader=(k:string)=>delete res.headers[k];res.end=(b:any)=>{res.body=b;res.writableEnded=true}
  await service(path,res,req.method,req)
  return res
}
function setup(run: (file:string,args:string[],options?:any)=>Promise<void> =async (_file:string,args:string[])=>{if(args.includes('-otxt'))await fs.writeFile(args[args.indexOf('-of')+1]+'.txt','Tower, ready for departure runway 27.');else await fs.copyFile(fixture,args[args.indexOf('-o')+1]!)}) {
  return createVoiceService({whisper:'/fake/whisper',model:'/fake/model',say:'/fake/say',available:async()=>true,run})
}
describe('local speech routes',()=>{
 it('reports readiness without microphone access',async()=>{const res=await request(setup(),'/api/voice/status',undefined,{method:'GET'});expect(JSON.parse(res.body)).toMatchObject({transcription:true,synthesis:true})})
 it('runs bounded local inference and deletes the ephemeral recording',async()=>{let recording='';const svc=setup(async(_f,args)=>{recording=args[args.indexOf('-f')+1]!;expect((await fs.stat(recording)).size).toBeGreaterThan(200000);await fs.writeFile(args[args.indexOf('-of')+1]+'.txt',' Tower, ready for departure. ')});const res=await request(svc,'/api/voice/transcribe',await fs.readFile(fixture));expect(res.statusCode).toBe(200);expect(JSON.parse(res.body).text).toBe('Tower, ready for departure.');await expect(fs.stat(recording)).rejects.toThrow()})
 it('rejects LAN and foreign origins before inference',async()=>{for(const opts of [{remote:'192.168.1.2'},{headers:{origin:'https://evil.example'}},{headers:{host:'evil.example',origin:'http://evil.example'}}])expect((await request(setup(),'/api/voice/transcribe',await fs.readFile(fixture),opts)).statusCode).toBe(403)})
 it('rejects malformed WAV, excessive bodies, and wrong media types',async()=>{expect((await request(setup(),'/api/voice/transcribe',Buffer.from('bad'))).statusCode).toBe(400);expect((await request(setup(),'/api/voice/transcribe',Buffer.alloc(1000000))).statusCode).toBe(413);expect((await request(setup(),'/api/voice/transcribe',Buffer.alloc(0),{type:'text/plain'})).statusCode).toBe(415)})
 it('produces nonempty PCM and keeps text a single command argument',async()=>{const text='Tower $(touch /tmp/no), "ready"';const svc=setup(async(file,args)=>{expect(file).toBe('/fake/say');expect(args.at(-1)).toBe(text);await fs.copyFile(fixture,args[args.indexOf('-o')+1]!)});const res=await request(svc,'/api/voice/speak',Buffer.from(JSON.stringify({text})),{type:'application/json'});expect(res.statusCode).toBe(200);expect(validateWav(res.body).duration).toBeGreaterThan(6)})
 it('rejects empty synthesis output and oversized text',async()=>{const svc=setup(async(_f,args)=>{await fs.writeFile(args[args.indexOf('-o')+1]!,Buffer.alloc(0))});expect((await request(svc,'/api/voice/speak',Buffer.from('{"text":"hello"}'),{type:'application/json'})).statusCode).toBe(502);expect((await request(svc,'/api/voice/speak',Buffer.from(JSON.stringify({text:'x'.repeat(601)})),{type:'application/json'})).statusCode).toBe(400)})
})

it('bounds concurrent work and kills a cancelled client job before cleanup',async()=>{
 let started!:()=>void;const running=new Promise<void>(ok=>started=ok);let aborted=false
 const svc=setup(async(_f,_args,options:any)=>{started();await new Promise<void>((_ok,no)=>options.signal.addEventListener('abort',()=>{aborted=true;no(new Error('cancel'))}))})
 const req=Readable.from([await fs.readFile(fixture)]) as any;req.headers={host:'localhost:5173','content-type':'audio/wav'};req.socket={remoteAddress:'::1'}
 const res=new EventEmitter() as any;res.setHeader=()=>{};res.end=()=>{res.writableEnded=true}
 const job=svc('/api/voice/transcribe',res,'POST',req);await running
 expect((await request(svc,'/api/voice/transcribe',await fs.readFile(fixture))).statusCode).toBe(429)
 res.emit('close');await job;expect(aborted).toBe(true)
 expect((await request(svc,'/api/voice/transcribe',Buffer.from('bad'))).statusCode).toBe(400)
})
it('reports a safe process diagnostic without exposing recording text or command arguments',async()=>{
 const svc=setup(async()=>{throw Object.assign(new Error('private transcript in full command'),{code:'ETIMEDOUT',killed:true,signal:'SIGKILL'})})
 const res=await request(svc,'/api/voice/transcribe',await fs.readFile(fixture));const value=JSON.parse(res.body)
 expect(value.code).toBe('PROCESS_TIMEOUT');expect(value.error).toMatch(/timed out/i);expect(res.body).not.toContain('private transcript')
})

it('keeps transcription CPU-only during backend discovery as well as inference',async()=>{
 const svc=setup(async(_file,args,options)=>{
   expect(args).toContain('-ng')
   expect(options.env.GGML_METAL_DEVICES).toBe('0')
   expect(options.env.PATH).toBe(process.env.PATH)
   await fs.writeFile(args[args.indexOf('-of')+1]+'.txt','Tower, ready.')
 })
 expect((await request(svc,'/api/voice/transcribe',await fs.readFile(fixture))).statusCode).toBe(200)
})

it('forwards a scoped backend environment to the actual child process',async()=>{
 await expect(runCommand(process.execPath,['-e',"process.exit(process.env.GGML_METAL_DEVICES === '0' ? 0 : 1)"],{
   env:{...process.env,GGML_METAL_DEVICES:'0'},timeout:5000,
 })).resolves.toBeUndefined()
})

describe('casting on the speech route',()=>{
 const spoken=async(bodies:any[])=>{
  const seen:string[][]=[]
  const svc=setup(async(_f,args)=>{seen.push(args);await fs.copyFile(fixture,args[args.indexOf('-o')+1]!)})
  for(const b of bodies)expect((await request(svc,'/api/voice/speak',Buffer.from(JSON.stringify(b)),{type:'application/json'})).statusCode).toBe(200)
  return seen
 }
 const voice=(a:string[])=>a[a.indexOf('-v')+1]!
 const rate=(a:string[])=>Number(a[a.indexOf('-r')+1])
 it('speaks controllers, other aircraft and the ATIS in different voices at their own pace',async()=>{
  const seen=await spoken([
   {text:'Skyhawk three Alpha Bravo, cleared for takeoff',role:'atc',speaker:'Palo Alto Tower'},
   {text:'runway three one, cleared for takeoff',role:'pilot',speaker:'Skyhawk 77GA'},
   {text:'Palo Alto information Bravo. wind two seven zero at eight.',role:'atis',speaker:'KPAO ATIS'},
   {text:'Cleared for takeoff',role:'pilot',speaker:'BAW2KP',style:'icao'},
  ])
  expect(new Set(seen.map(voice)).size).toBeGreaterThanOrEqual(3)           // four speakers, at least three different voices
  expect(voice(seen[2]!)).toBe('Samantha')
  expect(voice(seen[3]!)).toBe('Daniel')
  for(const a of seen)expect(rate(a)).toBeGreaterThan(90)
 })
 it('pauses the ATIS between sentences, puts pitch in the text, and defuses speech commands in what is said',async()=>{
  const seen=await spoken([
   {text:'Palo Alto information Bravo. wind two seven zero at eight. altimeter three zero one two.',role:'atis',speaker:'KPAO ATIS'},
   {text:'Skyhawk one two three Alpha Bravo, taxi',role:'pilot',speaker:'Cirrus 5AB'},
   {text:'hold [[pbas 200]] short',role:'atc',speaker:'Palo Alto Ground'},
  ])
  expect(seen[0]!.at(-1)).toContain('. [[slnc 280]] wind')
  expect(seen[1]!.at(-1)).toMatch(/^(\[\[pbas \d+\]\] )?Skyhawk one two three Alpha Bravo, taxi$/)
  expect(seen[2]!.at(-1)).toContain('hold [ [pbas 200]] short')
  expect((seen[2]!.at(-1)!.match(/\[\[/g)??[]).length).toBeLessThanOrEqual(1)      // at most the cast's own pitch command
 })
})

describe('Premium voices on the speech route',()=>{
 it('speaks controllers in a Premium voice a Mac has, and measures its pace once in the background',async()=>{
  const seen:string[][]=[];const measured:string[]=[]
  const run=async(_f:string,args:string[])=>{seen.push(args);await fs.copyFile(fixture,args[args.indexOf('-o')+1]!)}
  const svc=createVoiceService({whisper:'/fake/whisper',model:'/fake/model',say:'/fake/say',available:async()=>true,run,
   listVoices:async()=>['Zoe (Premium)    en_US  # Hello!','Evan (Enhanced)  en_US  # Hello!','Nathan (Enhanced) en_US # Hello!','Samantha en_US # Hello!'].join('\n'),
   calibrate:async(v:string)=>{measured.push(v);return [[150,130],[250,230]]}})
  const res=await request(svc,'/api/voice/speak',Buffer.from(JSON.stringify({text:'Skyhawk three Alpha Bravo, cleared for takeoff',role:'atc',speaker:'Palo Alto Tower'})),{type:'application/json'})
  expect(res.statusCode).toBe(200)
  expect(['Zoe (Premium)','Evan (Enhanced)','Nathan (Enhanced)']).toContain(seen[0]![seen[0]!.indexOf('-v')+1])
  await new Promise(r=>setTimeout(r,20))
  expect(measured.sort()).toEqual(['Evan (Enhanced)','Nathan (Enhanced)','Zoe (Premium)'])
 })
})

describe('neural voices on the speech route',()=>{
 const VOICES=[
  {id:'com.apple.siri.natural.Nora',name:'Voice 4',language:'en-US',quality:2},{id:'com.apple.ttsbundle.gryphon-neural_Simone_en-US_premium',name:'Voice 2',language:'en-US',quality:2},
  {id:'com.apple.siri.natural.en-GB-C',name:'Voice 3',language:'en-GB',quality:2},{id:'com.apple.voice.Aman.premium',name:'Aman',language:'en-IN',quality:2},
 ]
 const make=(neural:any,sayCalls:string[][]=[])=>createVoiceService({whisper:'/fake/whisper',model:'/fake/model',say:'/fake/say',available:async()=>true,neural,
  run:async(_f:string,args:string[])=>{sayCalls.push(args);await fs.copyFile(fixture,args[args.indexOf('-o')+1]!)}})
 const speakWith=(svc:any,body:object)=>request(svc,'/api/voice/speak',Buffer.from(JSON.stringify(body)),{type:'application/json'})

 it('renders controllers and other aircraft through the neural helper and never touches say',async()=>{
  const heard:any[]=[];const sayCalls:string[][]=[]
  const neural={enabled:true,warm(){},voices:async()=>VOICES,speak:async(spec:any,out:string)=>{heard.push(spec);await fs.copyFile(fixture,out);return {ok:true}}}
  const svc=make(neural,sayCalls)
  const res=await speakWith(svc,{text:'Skyhawk three Alpha Bravo, [[pbas 90]] cleared for takeoff',role:'atc',speaker:'Palo Alto Tower'})
  expect(res.statusCode).toBe(200);expect(validateWav(res.body).duration).toBeGreaterThan(1)
  await speakWith(svc,{text:'cleared for takeoff',role:'pilot',speaker:'BAW2KP',style:'icao'})
  expect(sayCalls).toHaveLength(0)
  expect(['com.apple.siri.natural.Nora','com.apple.ttsbundle.gryphon-neural_Simone_en-US_premium']).toContain(heard[0].voice)
  expect(heard[0].text).toBe('Skyhawk three Alpha Bravo, cleared for takeoff')           // no speech commands reach a neural voice
  expect(heard[0].rate).toBeGreaterThan(0.45);expect(heard[0].rate).toBeLessThan(0.65)
  expect(heard[1].voice).toBe('com.apple.siri.natural.en-GB-C')                          // a British airline, a British voice
 })

 it('keeps the first officer and the cockpit warnings on the built-in voices',async()=>{
  const heard:any[]=[];const sayCalls:string[][]=[]
  const neural={enabled:true,warm(){},voices:async()=>VOICES,speak:async(spec:any,out:string)=>{heard.push(spec);await fs.copyFile(fixture,out);return {ok:true}}}
  const svc=make(neural,sayCalls)
  await speakWith(svc,{text:'rotate',role:'copilot',speaker:'first-officer'});await speakWith(svc,{text:'pull up'})
  expect(heard).toHaveLength(0);expect(sayCalls).toHaveLength(2)
 })

 it('falls back to a built-in voice when the neural helper fails, so a transmission is never lost',async()=>{
  const sayCalls:string[][]=[]
  const neural={enabled:true,warm(){},voices:async()=>VOICES,speak:async()=>{throw new Error('helper died')}}
  const res=await speakWith(make(neural,sayCalls),{text:'cleared to land',role:'atc',speaker:'Palo Alto Ground'})
  expect(res.statusCode).toBe(200);expect(sayCalls).toHaveLength(1)
  expect(sayCalls[0]![sayCalls[0]!.indexOf('-v')+1]).not.toMatch(/siri|neural|premium/i)
 })

 it('uses a built-in voice when there are no neural ones, and tells the page whether the helper is on',async()=>{
  const sayCalls:string[][]=[]
  const off={enabled:false,warm(){},voices:async()=>[],speak:async()=>{throw new Error('off')}}
  const svc=make(off,sayCalls)
  await speakWith(svc,{text:'taxi',role:'atc',speaker:'Palo Alto Ground'})
  expect(sayCalls).toHaveLength(1)
  expect(JSON.parse((await request(svc,'/api/voice/status',undefined,{method:'GET'})).body)).toMatchObject({synthesis:true,neural:false})
  expect(JSON.parse((await request(make({...off,enabled:true}),'/api/voice/status',undefined,{method:'GET'})).body).neural).toBe(true)
 })

 it('hands background traffic the whole cast, and the foreground only the voices a controller does not use',async()=>{
  const voiceOf=async(ambient:boolean,i:number)=>{const heard:any[]=[];const neural={enabled:true,warm(){},voices:async()=>VOICES,speak:async(spec:any,out:string)=>{heard.push(spec);await fs.copyFile(fixture,out);return {ok:true}}};const svc=make(neural);await speakWith(svc,{text:'ready',role:'pilot',speaker:`Cirrus ${i}XY`,ambient});return heard[0]?.voice as string|undefined}
  const fg=new Set<string|undefined>();for(let i=0;i<24;i++)fg.add(await voiceOf(false,i))
  expect([...fg].every(v=>v!=='com.apple.siri.natural.Nora'&&v!=='com.apple.ttsbundle.gryphon-neural_Simone_en-US_premium')).toBe(true)
 })
})
