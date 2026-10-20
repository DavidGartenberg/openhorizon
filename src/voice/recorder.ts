import type {Capture} from './ptt'

/** End-of-speech detection state (see `vadStep`). */
export interface VadState {noise:number;voicedS:number;silentS:number;elapsedS:number;fired:boolean}
export const makeVad=():VadState=>({noise:0.004,voicedS:0,silentS:0,elapsedS:0,fired:false})
/** Feed one chunk's RMS level and duration; returns true once, when the speaker has finished:
 *  after at least 0.3 s of speech, 1.1 s of quiet. A mic that never hears speech gives up after 8 s.
 *  The noise floor adapts to the room, so a hum is not mistaken for talking. Pure. */
export function vadStep(s:VadState,rms:number,dtS:number):boolean {
  if(s.fired)return false
  s.elapsedS+=dtS
  const threshold=Math.max(0.012,s.noise*3.2)
  if(rms>threshold){s.voicedS+=dtS;s.silentS=0}
  else{
    s.noise+=(rms-s.noise)*Math.min(1,dtS*1.5) // learn the room while it is quiet
    if(s.voicedS>=0.3)s.silentS+=dtS
  }
  const done=(s.voicedS>=0.3&&s.silentS>=1.1)||(s.voicedS<0.3&&s.elapsedS>=8)
  if(done)s.fired=true
  return done
}
export function encodeWav(chunks:Float32Array[],sampleRate:number):ArrayBuffer {
  const total=chunks.reduce((n,c)=>n+c.length,0),input=new Float32Array(total)
  let at=0;for(const chunk of chunks){input.set(chunk,at);at+=chunk.length}
  const count=Math.floor(total*16000/sampleRate),buf=new ArrayBuffer(44+count*2),v=new DataView(buf)
  const str=(at:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i))}
  str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true)
  v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true)
  for(let i=0;i<count;i++){
    const lo=Math.floor(i*sampleRate/16000),hi=Math.max(lo+1,Math.floor((i+1)*sampleRate/16000))
    let sum=0;for(let j=lo;j<hi;j++)sum+=input[j]??0
    const x=Math.max(-1,Math.min(1,sum/(hi-lo)))
    v.setInt16(44+i*2,x<0?Math.round(x*32768):Math.round(x*32767),true)
  }
  return buf
}
/** Audio stays in memory until release. ScriptProcessor is widely supported,
 * including embedded Chromium; the zero-gain sink never monitors the mic. */
export async function captureMicrophone(signal:AbortSignal,onEndOfSpeech?:()=>void):Promise<Capture> {
  if(!navigator.mediaDevices?.getUserMedia||typeof AudioContext==='undefined')throw new Error('Microphone recording unavailable — open this local site in Chrome, Edge, or Safari')
  const ctx=new AudioContext()
  let stream:MediaStream|undefined,processor:ScriptProcessorNode|undefined,source:MediaStreamAudioSourceNode|undefined,gain:GainNode|undefined
  let closed=false,samples=0,energy=0
  const chunks:Float32Array[]=[]
  const vad=makeVad()
  const close=()=>{if(closed)return;closed=true;signal.removeEventListener('abort',close);if(processor)processor.onaudioprocess=null;processor?.disconnect();source?.disconnect();gain?.disconnect();stream?.getTracks().forEach(t=>t.stop());void ctx.close().catch(()=>{})}
  signal.addEventListener('abort',close,{once:true})
  try {
    await ctx.resume()
    if(signal.aborted||closed)throw new Error('Microphone capture cancelled')
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false})
    if(signal.aborted||closed){stream.getTracks().forEach(t=>t.stop());throw new Error('Microphone capture cancelled')}
    source=ctx.createMediaStreamSource(stream);processor=ctx.createScriptProcessor(4096,1,1);gain=ctx.createGain();gain.gain.value=0
    processor.onaudioprocess=e=>{if(closed)return;const data=e.inputBuffer.getChannelData(0);const remaining=Math.max(0,Math.floor(ctx.sampleRate*20)-samples);const chunk=new Float32Array(data.subarray(0,remaining));chunks.push(chunk);samples+=chunk.length;let sq=0;for(const value of chunk){energy+=value*value;sq+=value*value};if(onEndOfSpeech&&chunk.length&&vadStep(vad,Math.sqrt(sq/chunk.length),chunk.length/ctx.sampleRate))queueMicrotask(onEndOfSpeech)}
    source.connect(processor);processor.connect(gain);gain.connect(ctx.destination)
    return {cancel:close,stop:async()=>{close();if(samples<ctx.sampleRate*.15||Math.sqrt(energy/Math.max(1,samples))<.002)throw new Error('No speech heard — check microphone and try again');return new Blob([encodeWav(chunks,ctx.sampleRate)],{type:'audio/wav'})}}
  }catch(error){close();throw error}
}
