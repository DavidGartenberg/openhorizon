import type {SpeechMessage} from '../audio/safety-speech'
import {applyRadioFilter,voiceRoleFor} from '../audio/radio-voice'
import {toSpokenAviation} from '../audio/spoken-aviation'
export interface LocalVoiceStatus {transcription:boolean;synthesis:boolean;engine:string;maxSeconds:number}
async function responseError(response:Response):Promise<Error>{let message=`Local speech HTTP ${response.status}`;try{const data=await response.json();if(typeof data.error==='string')message=data.error}catch{}return new Error(message)}
export class LocalVoiceClient {
  status:LocalVoiceStatus={transcription:false,synthesis:false,engine:'whisper.cpp',maxSeconds:20}
  async refresh():Promise<LocalVoiceStatus>{const response=await fetch('/api/voice/status',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw await responseError(response);this.status=await response.json();return this.status}
  async transcribe(audio:Blob,signal:AbortSignal):Promise<string>{const response=await fetch('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:audio,signal});if(!response.ok)throw await responseError(response);const result=await response.json();if(typeof result.text!=='string')throw new Error('Invalid local transcript');return result.text}
  /** Synthesized + radio-filtered clips by role/speaker/spoken text, so a phrase
   *  said before (or rendered ahead of its turn) plays with no server round trip. */
  private readonly clips=new Map<string,Blob>()
  private static readonly CLIP_MAX=64
  private clipKey(message:SpeechMessage,text:string):string{return `${voiceRoleFor(message)}|${message.style??''}|${message.speaker??''}|${text}`}
  private spoken(message:SpeechMessage):string{return message.spoken??toSpokenAviation(message.text,{style:message.style})}
  private remember(key:string,blob:Blob):void{
    this.clips.delete(key);this.clips.set(key,blob)
    if(this.clips.size>LocalVoiceClient.CLIP_MAX)this.clips.delete(this.clips.keys().next().value as string)
  }
  /** The local synthesizer does one job at a time. Speech that is due now goes ahead of rendering done in advance, and nothing ever
   *  collides with itself (a collision used to cost a transmission after four tries). */
  private running=false
  private readonly liveQueue:Array<()=>void>=[]
  private readonly warmQueue:Array<()=>void>=[]
  private next():void{
    if(this.running)return
    const grant=this.liveQueue.shift()??this.warmQueue.shift()
    if(grant){this.running=true;grant()}
  }
  private acquire(priority:'live'|'warm',signal:AbortSignal):Promise<()=>void>{
    return new Promise((resolve,reject)=>{
      const aborted=()=>new DOMException('Speech cancelled','AbortError')
      if(signal.aborted){reject(aborted());return}
      const queue=priority==='live'?this.liveQueue:this.warmQueue
      const grant=()=>{
        if(signal.aborted){this.running=false;this.next();reject(aborted());return}
        resolve(()=>{this.running=false;this.next()})
      }
      queue.push(grant)
      signal.addEventListener('abort',()=>{const at=queue.indexOf(grant);if(at>=0){queue.splice(at,1);reject(aborted())}},{once:true})
      this.next()
    })
  }
  private async synthesize(message:SpeechMessage,text:string,signal:AbortSignal,priority:'live'|'warm'='live'):Promise<Blob|undefined>{
    const release=await this.acquire(priority,signal)
    try{
      // Rendered ahead while it waited its turn: nothing left to do.
      const key=this.clipKey(message,text)
      if(priority==='warm'&&this.clips.has(key))return undefined
      // A 429 means the service is busy with something else (a transcription); wait a beat and try again.
      for(let attempt=0;;attempt++){
        const response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,role:voiceRoleFor(message),speaker:message.speaker,style:message.style}),signal})
        if(response.status===429&&attempt<8&&!signal.aborted){await new Promise(r=>setTimeout(r,250*(attempt+1)));continue}
        if(!response.ok)throw await responseError(response)
        const raw=await response.blob();if(raw.size<44)throw new Error('Local speech returned empty audio')
        const clip=await applyRadioFilter(raw,voiceRoleFor(message),message.speaker)
        // Kept before the synthesizer is handed on, so a copy waiting for the same phrase finds it.
        this.remember(key,clip)
        return clip
      }
    }finally{release()}
  }
  async resolveSpeech(message:SpeechMessage,signal:AbortSignal):Promise<{url:string;release():void}|undefined>{
    if(!this.status.synthesis)return undefined
    const text=this.spoken(message),key=this.clipKey(message,text)
    let blob=this.clips.get(key)
    if(blob)this.remember(key,blob)
    else{blob=await this.synthesize(message,text,signal,'live');if(!blob)throw new Error('Local speech produced no audio');this.remember(key,blob)}
    const url=URL.createObjectURL(blob);return {url,release:()=>URL.revokeObjectURL(url)}
  }
  /** Render one queued message in the background; the clip is kept for when its turn comes. */
  prepare(message:SpeechMessage):void{void this.prewarm([message],new AbortController().signal)}
  /** Render phrases ahead of need, in order and behind anything due now. Failures are ignored: warming is an optimization. */
  async prewarm(messages:readonly SpeechMessage[],signal:AbortSignal):Promise<void>{
    if(!this.status.synthesis)return
    for(const message of messages){
      if(signal.aborted)return
      const text=this.spoken(message),key=this.clipKey(message,text)
      if(this.clips.has(key))continue
      try{const blob=await this.synthesize(message,text,signal,'warm');if(blob)this.remember(key,blob)}catch{/* warming is best-effort */}
    }
  }
}
