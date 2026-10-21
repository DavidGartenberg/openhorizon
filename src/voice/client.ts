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
   *  said before (or warmed ahead of time) plays with no server round trip. */
  private readonly clips=new Map<string,Blob>()
  private inFlight=0
  private static readonly CLIP_MAX=64
  private clipKey(message:SpeechMessage,text:string):string{return `${voiceRoleFor(message)}|${message.speaker??''}|${text}`}
  private remember(key:string,blob:Blob):void{
    this.clips.delete(key);this.clips.set(key,blob)
    if(this.clips.size>LocalVoiceClient.CLIP_MAX)this.clips.delete(this.clips.keys().next().value as string)
  }
  private async synthesize(message:SpeechMessage,text:string,signal:AbortSignal):Promise<Blob>{
    this.inFlight++
    try{
      // The local synthesizer takes one request at a time; a 429 just means
      // another phrase is still being rendered, so wait a beat and try again.
      for(let attempt=0;;attempt++){
        const response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,role:voiceRoleFor(message),speaker:message.speaker}),signal})
        if(response.status===429&&attempt<3&&!signal.aborted){await new Promise(r=>setTimeout(r,250*(attempt+1)));continue}
        if(!response.ok)throw await responseError(response)
        const raw=await response.blob();if(raw.size<44)throw new Error('Local speech returned empty audio')
        return await applyRadioFilter(raw,voiceRoleFor(message))
      }
    }finally{this.inFlight--}
  }
  async resolveSpeech(message:SpeechMessage,signal:AbortSignal):Promise<{url:string;release():void}|undefined>{
    if(!this.status.synthesis)return undefined
    const text=toSpokenAviation(message.text),key=this.clipKey(message,text)
    let blob=this.clips.get(key)
    if(blob)this.remember(key,blob)
    else{blob=await this.synthesize(message,text,signal);this.remember(key,blob)}
    const url=URL.createObjectURL(blob);return {url,release:()=>URL.revokeObjectURL(url)}
  }
  /** Render phrases ahead of need, one at a time and only while no live phrase
   *  is being rendered. Failures are ignored: warming is an optimization. */
  async prewarm(messages:readonly SpeechMessage[],signal:AbortSignal):Promise<void>{
    if(!this.status.synthesis)return
    for(const message of messages){
      if(signal.aborted)return
      const text=toSpokenAviation(message.text),key=this.clipKey(message,text)
      if(this.clips.has(key))continue
      while(this.inFlight>0&&!signal.aborted)await new Promise(r=>setTimeout(r,200))
      try{this.remember(key,await this.synthesize(message,text,signal))}catch{/* warming is best-effort */}
    }
  }
}
