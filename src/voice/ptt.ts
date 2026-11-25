/** A capture ends in raw audio (transcribed afterwards) or, for browser speech
 *  recognition, directly in the recognized text. */
export interface Capture {stop():Promise<Blob|string>;cancel():void}
export interface VoiceState {phase:'idle'|'requesting'|'listening'|'processing'|'transcript'|'error';message:string;transcript:string}
interface Options {
  capture(signal:AbortSignal):Promise<Capture>
  transcribe(audio:Blob,signal:AbortSignal):Promise<string>
  send(text:string):void
  suspend(value:boolean):void
  context():string
  allowed():boolean
  onState?(state:VoiceState):void
  /** Shown while the transcript is being produced (default: local Whisper). */
  processingMessage?:string
  listeningMessage?:string
}
const digits:Record<string,string>={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',niner:'9'}
const WORD_UNITS:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,niner:9}
const WORD_TEENS:Record<string,number>={ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19}
const WORD_TENS:Record<string,number>={twenty:20,thirty:30,forty:40,fifty:50}
/** "five" → 5, "fifteen" → 15, "twenty five" → 25, "12" → 12; null if it is not a small number. */
function smallNumber(text:string):number|null {
  const t=text.toLowerCase().trim()
  if(/^\d{1,2}$/.test(t))return Number(t)
  const parts=t.split(/[ -]/)
  if(parts.length===1){const w=parts[0]!;if(w in WORD_UNITS&&w!=='zero')return WORD_UNITS[w]!;if(w in WORD_TEENS)return WORD_TEENS[w]!;if(w in WORD_TENS)return WORD_TENS[w]!;return null}
  if(parts.length===2&&parts[0]! in WORD_TENS&&parts[1]! in WORD_UNITS&&parts[1]!=='zero'&&parts[1]!=='niner'||parts.length===2&&parts[0]! in WORD_TENS&&parts[1]==='niner')return WORD_TENS[parts[0]!]!+WORD_UNITS[parts[1]!]!
  return null
}
const DIGIT_WORD='(?:zero|one|two|three|four|five|six|seven|eight|nine|niner)'
const DIGIT_TOKEN=`(?:${DIGIT_WORD}|[0-9])`
/** Spoken quantities → digits: runs of digit words ("two seven zero" → 270), thousands and
 *  hundreds ("three thousand five hundred" → 3500, "fifteen hundred" → 1500), decimals
 *  ("one one eight point seven" → 118.7). Single digit words are left alone ("number one"). */
function spokenQuantities(text:string):string {
  const NW='(?:one|two|three|four|five|six|seven|eight|nine|niner|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)'
  const NUM=`${NW}(?:[ -]${NW})?|\\d{1,2}`
  return text
    // runs of two or more single digits, spoken or spaced
    .replace(new RegExp(`\\b${DIGIT_TOKEN}(?:[ -]${DIGIT_TOKEN}\\b)+`,'gi'),run=>run.toLowerCase().split(/[ -]/).map(w=>w in WORD_UNITS?String(WORD_UNITS[w]):w).join(''))
    // "<n> thousand [<m> hundred]"
    .replace(new RegExp(`\\b(${NUM}) thousand\\b(?:\\s+(?:and\\s+)?(${NUM}) hundred\\b)?`,'gi'),(whole,th:string,hu?:string)=>{
      const t=smallNumber(th);if(t===null)return whole
      let n=t*1000
      if(hu!==undefined){const h=smallNumber(hu);if(h===null||h>9)return whole;n+=h*100}
      return String(n)
    })
    // "<n> hundred"
    .replace(new RegExp(`\\b(${NUM}) hundred\\b`,'gi'),(whole,hu:string)=>{const h=smallNumber(hu);return h===null?whole:String(h*100)})
    // "118 point 7"
    .replace(new RegExp(`\\b(\\d{1,4}) (?:point|decimal) (${DIGIT_TOKEN}(?:[ -]${DIGIT_TOKEN})*)\\b`,'gi'),(_w,whole:string,frac:string)=>`${whole}.${frac.toLowerCase().split(/[ -]/).map(x=>x in WORD_UNITS?String(WORD_UNITS[x]):x).join('')}`)
}
/** Deliberately narrow: never guess "to/for", unfamiliar callsigns, or intent. */
export function normalizeAviation(text:string):string {
  const nato:Record<string,string>={alpha:'A',alfa:'A',bravo:'B',charlie:'C',delta:'D',echo:'E',foxtrot:'F',golf:'G',hotel:'H',juliett:'J',juliet:'J',kilo:'K',lima:'L',mike:'M',november:'N',papa:'P',quebec:'Q',romeo:'R',sierra:'S',tango:'T',uniform:'U',victor:'V',whiskey:'W',xray:'X',yankee:'Y',zulu:'Z'}
  const d=DIGIT_WORD
  const normalized=text.trim().replace(new RegExp(`\\brunway (${d}(?:[ -]${d})?)(?: (left|right|center))?\\b`,'gi'),(whole,words:string,side:string)=>{
    const num=Number(words.toLowerCase().split(/[ -]/).map(w=>digits[w]).join(''))
    return num>=1&&num<=36?`runway ${String(num).padStart(2,'0')}${side?side[0]!.toUpperCase():''}`:whole
  }).replace(new RegExp(`\\b(${d}) thousand feet\\b`,'gi'),(_all,w:string)=>`${Number(digits[w.toLowerCase()])*1000} feet`)
  const legacy=normalized.replace(/\brunway (\d{1,2}) (left|right|center)\b/gi,(whole,n:string,side:string)=>Number(n)>=1&&Number(n)<=36?`runway ${n.padStart(2,'0')}${side[0]!.toUpperCase()}`:whole)
    .replace(new RegExp(`\\bNovember ((?:${d}|[1-9])(?:[ -](?:${d}|[0-9])){0,4})((?: (?:${Object.keys(nato).join('|')})){0,2})\\b`,'gi'),(whole,number:string,letters:string)=>{
      const numberText=number.toLowerCase().split(/[ -]/).map(w=>digits[w]??w).join('')
      const suffix=letters.trim()?letters.trim().toLowerCase().split(' ').map(w=>nato[w]).join(''):''
      return !numberText.startsWith('0')&&numberText.length+suffix.length<=5?`N${numberText}${suffix}`:whole
    })
  // After callsigns are protected: the general spoken-number pass, then runway sides once more
  // ("runway 2 8 left" → "runway 28 left" → "runway 28L").
  return spokenQuantities(legacy).replace(/\brunway (\d{1,2}) (left|right|center)\b/gi,(whole,n:string,side:string)=>Number(n)>=1&&Number(n)<=36?`runway ${n.padStart(2,'0')}${side[0]!.toUpperCase()}`:whole)
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
      this.publish('listening',this.options.listeningMessage??'Listening locally — release to transmit')
    }catch(error){if(token===this.token)this.cancel(error instanceof DOMException&&error.name==='NotAllowedError'?'Microphone permission denied — allow microphone in browser settings':error instanceof Error?error.message:'Microphone unavailable')}
  }
  private async finish(){
    const token=this.token,capture=this.capture,signal=this.abort!.signal
    if(!capture)return
    if(this.timer)clearTimeout(this.timer)
    this.publish('processing',this.options.processingMessage??'Transcribing locally…')
    this.timer=setTimeout(()=>this.cancel('Transcription timed out; please try again'),35000)
    try{
      const audio=await capture.stop()
      if(token!==this.token)return
      this.capture=undefined
      this.suspend(false)
      const raw=(typeof audio==='string'?audio:await this.options.transcribe(audio,signal)).trim()
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
