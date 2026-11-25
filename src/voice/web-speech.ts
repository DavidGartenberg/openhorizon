/**
 * Browser speech recognition (Web Speech API) as a zero-install way to talk
 * to ATC when no local Whisper is set up. Honest trade-off, shown in the UI:
 * unlike local Whisper, the browser's speech service (Chrome → Google,
 * Safari → Apple) processes the audio. Push-to-talk only: recognition runs
 * while the key is held and never otherwise.
 */
import type {Capture} from './ptt'

interface RecognitionResult {isFinal:boolean;0:{transcript:string}}
interface RecognitionEvent {resultIndex:number;results:ArrayLike<RecognitionResult>}
interface RecognitionLike {
  lang:string;continuous:boolean;interimResults:boolean;maxAlternatives:number
  onresult:((e:RecognitionEvent)=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;onstart:(()=>void)|null
  start():void;stop():void;abort():void
}
type RecognitionCtor=new()=>RecognitionLike

function ctor():RecognitionCtor|undefined {
  const w=globalThis as unknown as {SpeechRecognition?:RecognitionCtor;webkitSpeechRecognition?:RecognitionCtor}
  return w.SpeechRecognition??w.webkitSpeechRecognition
}
export function webSpeechAvailable():boolean {return typeof ctor()==='function'}

/** Human text for a Web Speech error code. Pure. */
export function webSpeechErrorMessage(code:string):string {
  switch(code){
    case 'not-allowed':case 'service-not-allowed':return 'Microphone or speech permission denied — allow it in the browser, or use typed ATC'
    case 'no-speech':return 'No speech heard — hold and speak clearly'
    case 'audio-capture':return 'No microphone found — check your input device'
    case 'network':return 'Browser speech service unreachable — check your connection, or set up local Whisper (docs/voice-atc.md)'
    case 'language-not-supported':return 'Browser speech recognition does not support English here'
    default:return `Browser speech recognition failed (${code}) — use typed ATC`
  }
}

/** Join the finished segments and the in-flight one into one transcript. Pure. */
export function joinTranscript(finals:readonly string[],interim:string):string {
  return [...finals,interim].map(x=>x.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ')
}

/** Start recognizing; `stop()` resolves with the final text. */
/** `onEnded` fires when the recognizer stops by itself (the speaker finished), so a hands-free
 *  "click to talk" can send the transmission without a release event. */
export async function captureWebSpeech(signal:AbortSignal,onInterim?:(text:string)=>void,onEnded?:()=>void):Promise<Capture> {
  const Ctor=ctor()
  if(!Ctor)throw new Error('Browser speech recognition is unavailable — use Chrome, Edge or Safari, or typed ATC')
  const rec=new Ctor()
  rec.lang='en-US';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1
  const finals:string[]=[]
  let interim='',error='',ended=false,byUs=false
  let endWaiters:Array<()=>void>=[]
  const finish=()=>{ended=true;for(const w of endWaiters)w();endWaiters=[]}
  rec.onresult=e=>{
    interim=''
    for(let i=e.resultIndex;i<e.results.length;i++){
      const r=e.results[i]!,text=r[0].transcript
      if(r.isFinal)finals.push(text);else interim+=text
    }
    onInterim?.(joinTranscript(finals,interim))
  }
  rec.onerror=e=>{if(e.error!=='aborted'&&!error)error=e.error}
  rec.onend=()=>{finish();if(!byUs)onEnded?.()}
  const cancel=()=>{byUs=true;signal.removeEventListener('abort',cancel);rec.onresult=null;rec.onerror=null;rec.onend=null;try{rec.abort()}catch{}finish()}
  signal.addEventListener('abort',cancel,{once:true})
  const started=new Promise<void>((resolve,reject)=>{
    rec.onstart=()=>resolve()
    const early=rec.onerror
    rec.onerror=e=>{early?.(e);if(e.error==='not-allowed'||e.error==='service-not-allowed'){reject(new DOMException(webSpeechErrorMessage(e.error),'NotAllowedError'))}}
    try{rec.start()}catch(err){reject(err instanceof Error?err:new Error('Speech recognition would not start'))}
  })
  await started
  return {
    cancel,
    stop:async()=>{
      byUs=true
      signal.removeEventListener('abort',cancel)
      if(!ended){
        await new Promise<void>(resolve=>{endWaiters.push(resolve);const t=setTimeout(resolve,4000);endWaiters.push(()=>clearTimeout(t));try{rec.stop()}catch{resolve()}})
      }
      const text=joinTranscript(finals,interim)
      if(!text){throw new Error(error?webSpeechErrorMessage(error):'No speech heard — hold and speak clearly')}
      return text
    },
  }
}
