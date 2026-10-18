import type {SpeechMessage} from '../audio/safety-speech'
import {applyRadioFilter,voiceRoleFor} from '../audio/radio-voice'
export interface LocalVoiceStatus {transcription:boolean;synthesis:boolean;engine:string;maxSeconds:number}
async function responseError(response:Response):Promise<Error>{let message=`Local speech HTTP ${response.status}`;try{const data=await response.json();if(typeof data.error==='string')message=data.error}catch{}return new Error(message)}
export class LocalVoiceClient {
  status:LocalVoiceStatus={transcription:false,synthesis:false,engine:'whisper.cpp',maxSeconds:20}
  async refresh():Promise<LocalVoiceStatus>{const response=await fetch('/api/voice/status',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw await responseError(response);this.status=await response.json();return this.status}
  async transcribe(audio:Blob,signal:AbortSignal):Promise<string>{const response=await fetch('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:audio,signal});if(!response.ok)throw await responseError(response);const result=await response.json();if(typeof result.text!=='string')throw new Error('Invalid local transcript');return result.text}
  async resolveSpeech(message:SpeechMessage,signal:AbortSignal):Promise<{url:string;release():void}|undefined>{
    if(!this.status.synthesis)return undefined
    const response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:message.text,role:voiceRoleFor(message),speaker:message.speaker}),signal})
    if(!response.ok)throw await responseError(response)
    const raw=await response.blob();if(raw.size<44)throw new Error('Local speech returned empty audio')
    const blob=await applyRadioFilter(raw,voiceRoleFor(message))
    const url=URL.createObjectURL(blob);return {url,release:()=>URL.revokeObjectURL(url)}
  }
}
