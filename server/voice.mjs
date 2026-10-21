/** Loopback-only, ephemeral speech. No shell, external service, or durable recordings. */
import fs from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'

const MAX_WAV = 44 + 16000 * 2 * 20 + 4096
function failure(status,message) { return Object.assign(new Error(message),{status}) }
export function validateWav(buf,maxSeconds=20) {
  if(buf.length<44 || buf.toString('ascii',0,4)!=='RIFF' || buf.toString('ascii',8,12)!=='WAVE' || buf.readUInt32LE(4)+8!==buf.length) throw failure(400,'Invalid PCM WAV')
  let format, size=0
  for(let at=12;at+8<=buf.length;) {
    const id=buf.toString('ascii',at,at+4), n=buf.readUInt32LE(at+4), start=at+8
    if(start+n>buf.length)throw failure(400,'Truncated WAV')
    if(id==='fmt ' && n>=16) format={encoding:buf.readUInt16LE(start),channels:buf.readUInt16LE(start+2),rate:buf.readUInt32LE(start+4),bits:buf.readUInt16LE(start+14)}
    if(id==='data')size+=n
    at=start+n+(n%2)
  }
  if(!format || format.encoding!==1 || format.channels!==1 || format.rate!==16000 || format.bits!==16 || size<3200 || size%2 || size>32000*maxSeconds)throw failure(400,'Use mono 16 kHz PCM16 WAV, 0.1–20 seconds')
  return {duration:size/32000}
}
export function runCommand(file,args,{signal,timeout=30000,env=process.env}={}) {
  return new Promise((resolve,reject)=>{
    execFile(file,args,{signal,timeout,env,killSignal:'SIGKILL',maxBuffer:256*1024,windowsHide:true},error=>error?reject(error):resolve())
  })
}
function trusted(req) {
  const ip=req?.socket?.remoteAddress
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip))return false
  try {
    const host=new URL(`http://${req.headers.host}`)
    if(!['localhost','127.0.0.1','[::1]'].includes(host.hostname))return false
    const origin=req.headers.origin
    if(origin) {const o=new URL(origin);if(!['http:','https:'].includes(o.protocol)||o.host!==host.host)return false}
    if(req.headers['sec-fetch-site']==='cross-site')return false
    return true
  }catch{return false}
}
async function body(req,max,signal) {
  if(Number(req.headers['content-length'])>max)throw failure(413,'Speech request too large')
  const chunks=[];let bytes=0
  const abort=()=>req.destroy(failure(408,'Speech upload timed out or cancelled'))
  signal.addEventListener('abort',abort,{once:true})
  try {for await(const chunk of req){const b=Buffer.from(chunk);bytes+=b.length;if(bytes>max)throw failure(413,'Speech request too large');chunks.push(b)}return Buffer.concat(chunks,bytes)}
  finally{signal.removeEventListener('abort',abort)}
}
/** Aviation voices (macOS `say`): controllers are male US voices with a
 *  per-facility pick, the first officer is a distinct crew voice, and
 *  automated cockpit warnings keep the classic female GPWS voice. Real
 *  controllers talk fast; real crews are clipped — rates reflect that. */
const VOICES = {
  // Rocko is the first officer's voice, so no controller may share it.
  atc: {names:['Reed (English (US))','Eddy (English (US))','Daniel'],rate:195},
  copilot: {names:['Rocko (English (US))'],rate:178},
  warning: {names:['Samantha'],rate:165},
}
export function pickVoice(role,speaker='') {
  const set=VOICES[role]??VOICES.warning
  let seed=0;for(const c of String(speaker))seed=(seed*31+c.charCodeAt(0))|0
  return {voice:set.names[Math.abs(seed)%set.names.length],rate:set.rate}
}
export function createVoiceService(options={}) {
  const whisper=options.whisper??process.env.OPENHORIZON_WHISPER_BIN??'/opt/homebrew/bin/whisper-cli'
  const model=options.model??process.env.OPENHORIZON_WHISPER_MODEL??fileURLToPath(new URL('./cache/speech/ggml-base.en.bin',import.meta.url))
  const say=options.say??'/usr/bin/say'
  const available=options.available??(async(file,executable=false)=>{try{await fs.access(file,executable?constants.X_OK:constants.R_OK);return true}catch{return false}})
  const run=options.run??runCommand
  let busy=false
  async function status(){return {transcription:await available(whisper,true)&&await available(model),synthesis:(options.say!==undefined||process.platform==='darwin')&&await available(say,true),engine:'whisper.cpp',maxSeconds:20}}
  return async function voiceRoute(url,res,method='GET',req) {
    const bare=url.split('?')[0]
    if(!['/api/voice/status','/api/voice/transcribe','/api/voice/speak'].includes(bare))return false
    res.removeHeader?.('Access-Control-Allow-Origin')
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff')
    const json=(code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))}
    if(!trusted(req)){json(403,{error:'Speech service is available only on this computer and origin'});return true}
    if(bare.endsWith('/status')){if(method!=='GET')json(405,{error:'Use GET'});else json(200,await status());return true}
    if(method!=='POST'){json(405,{error:'Use POST'});return true}
    const synth=bare.endsWith('/speak'), type=(req.headers['content-type']??'').split(';')[0]
    if(type!==(synth?'application/json':'audio/wav')){json(415,{error:'Invalid speech content type'});return true}
    if(busy){json(429,{error:'Speech service is busy; try again'});return true}
    busy=true
    const cancel=new AbortController();let dir,stage='availability'
    const abort=()=>cancel.abort()
    const closed=()=>{if(!res.writableEnded)abort()}
    req.once('aborted',abort);res.once('close',closed)
    const timer=setTimeout(abort,options.timeoutMs??35000)
    try{
      const ready=await status()
      if(!(synth?ready.synthesis:ready.transcription))throw failure(503,synth?'Local speech output unavailable':'Local Whisper executable or English model missing')
      stage='upload'
      const data=await body(req,synth?4096:MAX_WAV,cancel.signal)
      let text,role,speaker
      if(synth){try{const j=JSON.parse(data.toString());text=j.text;role=j.role;speaker=j.speaker}catch{throw failure(400,'Invalid speech JSON')};if(typeof text!=='string'||!text.trim()||text.length>600||/[\x00-\x08\x0b-\x1f]/.test(text))throw failure(400,'Speech text must contain 1–600 printable characters')}
      else validateWav(data)
      if(cancel.signal.aborted)throw failure(408,'Speech request cancelled')
      stage='temporary-files'
      dir=await fs.mkdtemp(path.join(os.tmpdir(),'openhorizon-voice-'))
      const audio=path.join(dir,'audio.wav'),output=path.join(dir,'result')
      if(synth){
        stage='synthesis-process'
        const pick=pickVoice(typeof role==='string'?role:'warning',typeof speaker==='string'?speaker.slice(0,64):'')
        const say1=voice=>run(say,['-v',voice,'-r',String(pick.rate),'--file-format=WAVE','--data-format=LEI16@16000','-o',audio,'--',text],{signal:cancel.signal,timeout:30000})
        // A voice the user's Mac does not have must not silence the radio.
        try{await say1(pick.voice)}catch(error){if(cancel.signal.aborted||error.killed||pick.voice==='Samantha')throw error;await say1('Samantha')}
        stage='synthesis-output'
        const info=await fs.stat(audio);if(info.size>32000*60+4096)throw failure(502,'Speech output exceeds duration limit')
        const wav=await fs.readFile(audio)
        try{validateWav(wav,60)}catch{throw failure(502,'Local speech produced no valid PCM audio')}
        if(!cancel.signal.aborted){res.statusCode=200;res.setHeader('Content-Type','audio/wav');res.end(wav)}
      }else{
        await fs.writeFile(audio,data,{mode:0o600})
        stage='transcription-process'
        // -ng disables GPU inference, but ggml still initializes Metal during
        // backend discovery. Skip those devices too: shader initialization can
        // stall the local speech process while the simulator is rendering.
        await run(whisper,['-m',model,'-f',audio,'-otxt','-of',output,'-nt','-np','-t','4','-ng','-l','en'],{signal:cancel.signal,timeout:30000,env:{...process.env,GGML_METAL_DEVICES:'0'}})
        stage='transcription-output'
        const info=await fs.stat(output+'.txt');if(info.size>8192)throw failure(502,'Transcript exceeds limit')
        const text=(await fs.readFile(output+'.txt','utf8')).trim().replace(/\[(?:BLANK_AUDIO|SILENCE)\]/gi,'').trim()
        if(!cancel.signal.aborted)json(200,{text})
      }
    }catch(error){
      const code=cancel.signal.aborted?'REQUEST_CANCELLED':error.killed?'PROCESS_TIMEOUT':error.code==='ENOENT'?'FILE_MISSING':error.code==='EACCES'||error.code==='EPERM'?'PROCESS_PERMISSION':error.status?'INVALID_REQUEST':'PROCESS_FAILED'
      if(!res.destroyed&&!res.writableEnded)json(error.status??(cancel.signal.aborted?408:502),{error:error.status?error.message:code==='PROCESS_TIMEOUT'?'Local speech process timed out':cancel.signal.aborted?'Speech request timed out or cancelled':'Local speech process failed; check installation and microphone audio',code,stage})
    }
    finally{clearTimeout(timer);req.removeListener('aborted',abort);res.removeListener('close',closed);try{if(dir)await fs.rm(dir,{recursive:true,force:true})}finally{busy=false}}
    return true
  }
}
export const voiceRoute=createVoiceService()
