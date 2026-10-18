export interface Capture {stop():Promise<Blob>;cancel():void}
export interface VoiceState {phase:'idle'|'requesting'|'listening'|'processing'|'transcript'|'error';message:string;transcript:string}
interface Options {
  capture(signal:AbortSignal):Promise<Capture>
  transcribe(audio:Blob,signal:AbortSignal):Promise<string>
  send(text:string):void
  suspend(value:boolean):void
  context():string
  allowed():boolean
  onState?(state:VoiceState):void
}
const digits:Record<string,string>={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',niner:'9'}
/** Deliberately narrow: never guess "to/for", unfamiliar callsigns, or intent. */
export function normalizeAviation(text:string):string {
  const nato:Record<string,string>={alpha:'A',alfa:'A',bravo:'B',charlie:'C',delta:'D',echo:'E',foxtrot:'F',golf:'G',hotel:'H',juliett:'J',juliet:'J',kilo:'K',lima:'L',mike:'M',november:'N',papa:'P',quebec:'Q',romeo:'R',sierra:'S',tango:'T',uniform:'U',victor:'V',whiskey:'W',xray:'X',yankee:'Y',zulu:'Z'}
  const d='(?:zero|one|two|three|four|five|six|seven|eight|nine|niner)'
  const normalized=text.trim().replace(new RegExp(`\\brunway (${d}(?:[ -]${d})?)(?: (left|right|center))?\\b`,'gi'),(whole,words:string,side:string)=>{
    const num=Number(words.toLowerCase().split(/[ -]/).map(w=>digits[w]).join(''))
    return num>=1&&num<=36?`runway ${String(num).padStart(2,'0')}${side?side[0]!.toUpperCase():''}`:whole
  }).replace(new RegExp(`\\b(${d}) thousand feet\\b`,'gi'),(_all,w:string)=>`${Number(digits[w.toLowerCase()])*1000} feet`)
  return normalized.replace(/\brunway (\d{1,2}) (left|right|center)\b/gi,(whole,n:string,side:string)=>Number(n)>=1&&Number(n)<=36?`runway ${n.padStart(2,'0')}${side[0]!.toUpperCase()}`:whole)
    .replace(new RegExp(`\\bNovember ((?:${d}|[1-9])(?:[ -](?:${d}|[0-9])){0,4})((?: (?:${Object.keys(nato).join('|')})){0,2})\\b`,'gi'),(whole,number:string,letters:string)=>{
      const numberText=number.toLowerCase().split(/[ -]/).map(w=>digits[w]??w).join('')
      const suffix=letters.trim()?letters.trim().toLowerCase().split(' ').map(w=>nato[w]).join(''):''
      return !numberText.startsWith('0')&&numberText.length+suffix.length<=5?`N${numberText}${suffix}`:whole
    })
}
/** One bounded capture and one final result; cancellation invalidates every await. */
export class PushToTalk {
  state:VoiceState={phase:'idle',message:'Hold T or Hold to talk',transcript:''}
  private held=new Set<string>()
  private polled=new Map<string,boolean>()
  private token=0
  private abort?:AbortController
  private capture?:Capture
  private timer?:ReturnType<typeof setTimeout>
  private sessionContext=''
  private suspended=false
  constructor(private readonly options:Options){}
  private publish(phase:VoiceState['phase'],message:string,transcript=this.state.transcript){this.state={phase,message,transcript};this.options.onState?.(this.state)}
  private suspend(value:boolean){if(value!==this.suspended){this.suspended=value;this.options.suspend(value)}}
  hold(source:string,down:boolean):void {
    if(down){if(this.held.has(source))return;const wasHeld=this.held.size>0;this.held.add(source);if(!wasHeld && this.state.phase!=='processing')void this.start()}
    else {this.held.delete(source);if(!this.held.size){if(this.state.phase==='requesting')this.cancel();else if(this.state.phase==='listening')void this.finish()}}
  }
  /** Poll physical state, never a synthetic input-clear. null means disconnected.
   * A source starts disarmed and every reset requires a real released sample. */
  poll(source:string,down:boolean|null):void {
    if(!this.polled.has(source))this.polled.set(source,false)
    if(down===null||!this.options.allowed()){
      this.polled.set(source,false)
      if(this.held.has(source))this.reset()
      return
    }
    if(!down){this.polled.set(source,true);this.hold(source,false);return}
    if(this.polled.get(source))this.hold(source,true)
  }
  private async start(){
    if(!this.options.allowed()){this.publish('error','Voice unavailable: resume flight, select ATC, and check local speech setup');return}
    const token=++this.token
    this.abort=new AbortController();this.sessionContext=this.options.context();this.suspend(true)
    this.publish('requesting','Requesting microphone — release to cancel')
    this.timer=setTimeout(()=>this.cancel('Microphone request timed out; release and try again'),15000)
    try{
      const capture=await this.options.capture(this.abort.signal)
      if(token!==this.token){capture.cancel();return}
      this.capture=capture
      if(this.timer)clearTimeout(this.timer)
      this.timer=setTimeout(()=>this.cancel('20-second limit reached; release and try a shorter transmission'),20000)
      this.publish('listening','Listening locally — release to transmit')
    }catch(error){if(token===this.token)this.cancel(error instanceof DOMException&&error.name==='NotAllowedError'?'Microphone permission denied — allow microphone in browser settings':error instanceof Error?error.message:'Microphone unavailable')}
  }
  private async finish(){
    const token=this.token,capture=this.capture,signal=this.abort!.signal
    if(!capture)return
    if(this.timer)clearTimeout(this.timer)
    this.publish('processing','Transcribing locally…')
    this.timer=setTimeout(()=>this.cancel('Transcription timed out; please try again'),35000)
    try{
      const audio=await capture.stop()
      if(token!==this.token)return
      this.capture=undefined
      this.suspend(false)
      const raw=(await this.options.transcribe(audio,signal)).trim()
      if(token!==this.token)return
      if(this.options.context()!==this.sessionContext||!this.options.allowed()){this.cancel('Flight or radio changed; transmission discarded');return}
      if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.abort=undefined
      if(!raw){this.publish('error','No speech heard — hold and speak clearly');return}
      this.publish('transcript',`Sent: ${raw}`,raw)
      ++this.token
      this.options.send(normalizeAviation(raw))
    }catch(error){if(token===this.token)this.cancel(error instanceof Error?error.message:'Transcription failed')}
  }
  /** Poll whenever flight/frequency/pause state changes, including while processing. */
  checkContext():void {if(this.abort && (!this.options.allowed()||this.sessionContext!==this.options.context()))this.cancel('Flight or radio changed; transmission discarded')}
  cancel(message?:string):void {
    ++this.token;this.abort?.abort();this.abort=undefined;this.capture?.cancel();this.capture=undefined
    if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.suspend(false)
    this.publish(message?'error':'idle',message??'Cancelled — hold to talk again')
  }
  /** Lost focus/disconnect/teardown has no future release event to rely on. */
  reset(message?:string):void {this.cancel(message);this.held.clear();for(const source of this.polled.keys())this.polled.set(source,false)}
}
