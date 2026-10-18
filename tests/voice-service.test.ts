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
