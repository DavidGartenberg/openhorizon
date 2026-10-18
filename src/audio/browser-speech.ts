import {englishVoice, type SpeechDriver, type SpeechMessage} from './safety-speech'

export const STATIC_SAFETY_PHRASES = [
  'TRAFFIC, TRAFFIC', 'CLIMB, CLIMB', 'DESCEND, DESCEND', 'LEVEL OFF, LEVEL OFF', 'CLEAR OF CONFLICT',
  'PULL UP', 'SINK RATE', 'TERRAIN AHEAD, PULL UP', 'TERRAIN AHEAD', "DON'T SINK", 'TOO LOW, FLAPS',
  'TOO LOW, GEAR', 'GLIDESLOPE', 'BANK ANGLE', 'FIVE HUNDRED', 'FIFTY', 'FORTY', 'THIRTY', 'TWENTY', 'TEN',
] as const

const STATIC_PHRASES = new Set<string>(STATIC_SAFETY_PHRASES)

export interface BrowserAudio {
  preload: string
  currentTime: number
  src: string
  onplaying: ((...args:any[]) => void) | null
  onended: ((...args:any[]) => void) | null
  onerror: ((...args:any[]) => void) | null
  play(): Promise<void>
  pause(): void
}

interface BrowserUtterance {
  lang: string
  rate: number
  voice?: SpeechSynthesisVoice | {lang:string} | null
  onstart: ((...args:any[]) => void) | null
  onend: ((...args:any[]) => void) | null
  onerror: ((...args:any[]) => void) | null
}

interface BrowserSynth {
  cancel(): void
  speak(utterance: any): void
  getVoices(): readonly (SpeechSynthesisVoice | {lang:string})[]
}

export interface BrowserSpeechOptions {
  resolveDynamic?: (message:SpeechMessage,signal:AbortSignal)=>Promise<{url:string;release():void}|undefined>
  dynamicTimeoutMs?: number
  dynamicCompletionTimeoutMs?: number
  manifestUrl?: string
  resolveManifest?: () => Promise<Record<string, string>>
  createAudio?: (url: string) => BrowserAudio
  speechSynthesis?: BrowserSynth
  createUtterance?: (text: string) => BrowserUtterance
  onStart?: (message: SpeechMessage) => void
  onFailure?: (message: SpeechMessage, reason: string) => void
  startTimeoutMs?: number
  completionTimeoutMs?: number
  manifestTimeoutMs?: number
}

/**
 * Browser playback driver. Standard safety phrases use bounded, reusable PCM
 * clips; arbitrary text temporarily uses native synthesis with watchdogs.
 */
export class BrowserSpeechDriver implements SpeechDriver {
  readonly ready: Promise<void>
  private readonly clips = new Map<string, BrowserAudio>()
  private dynamicAbort?:AbortController
  private dynamicRelease?:(()=>void)
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private currentAudio: BrowserAudio | undefined
  private readonly manifestUrl: string
  private readonly createAudio: (url:string)=>BrowserAudio
  private readonly synth: BrowserSynth | undefined
  private readonly createUtterance: ((text:string)=>BrowserUtterance) | undefined
  private readonly startTimeoutMs: number
  private readonly completionTimeoutMs: number
  private manifestAvailable = false

  constructor(private readonly options: BrowserSpeechOptions = {}) {
    this.manifestUrl = options.manifestUrl ?? '/audio/safety/manifest.json'
    this.createAudio = options.createAudio ?? ((url) => new Audio(url) as BrowserAudio)
    this.synth = options.speechSynthesis ?? (typeof window !== 'undefined' ? window.speechSynthesis : undefined)
    this.createUtterance = options.createUtterance ?? (typeof SpeechSynthesisUtterance !== 'undefined' ? (text) => new SpeechSynthesisUtterance(text) : undefined)
    this.startTimeoutMs = options.startTimeoutMs ?? 2000
    this.completionTimeoutMs = options.completionTimeoutMs ?? 15000
    const resolveManifest = options.resolveManifest ?? (() => fetch(this.manifestUrl).then(async response => {
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`)
      return response.json() as Promise<Record<string,string>>
    }))
    this.ready = this.loadClipsBounded(resolveManifest,options.manifestTimeoutMs??3000)
  }

  private async loadClipsBounded(resolve:()=>Promise<Record<string,string>>,timeoutMs:number):Promise<void> {
    let timeout:ReturnType<typeof setTimeout>|undefined
    try {
      await Promise.race([
        this.loadClips(resolve),
        new Promise<never>((_ok,reject)=>{timeout=setTimeout(()=>reject(new Error('manifest timeout')),timeoutMs)}),
      ])
      this.manifestAvailable=true
    } catch { /* speak() reports a bounded, message-specific failure */ }
    finally { if(timeout!==undefined)clearTimeout(timeout) }
  }

  private async loadClips(resolve:()=>Promise<Record<string,string>>): Promise<void> {
    const manifest = await resolve()
    for (const phrase of STATIC_SAFETY_PHRASES) {
      const filename = manifest[phrase]
      if (!filename || filename.includes('..') || filename.startsWith('//')) continue
      const base = this.manifestUrl.slice(0, this.manifestUrl.lastIndexOf('/') + 1)
      const audio = this.createAudio(filename.startsWith('/') ? filename : base + filename)
      audio.preload = 'auto'
      this.clips.set(phrase, audio)
    }
  }

  cancel(): void {
    ++this.generation
    this.dynamicAbort?.abort();this.dynamicAbort=undefined
    this.dynamicRelease?.();this.dynamicRelease=undefined
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.currentAudio) {
      this.currentAudio.onplaying = this.currentAudio.onended = this.currentAudio.onerror = null
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
      this.currentAudio = undefined
    }
    try { this.synth?.cancel() } catch { /* unavailable native engine */ }
  }

  speak(message: SpeechMessage, done:()=>void): void {
    const token = ++this.generation
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (STATIC_PHRASES.has(message.text)) {
      void this.ready.then(() => {
        if (token !== this.generation) return
        const audio = this.clips.get(message.text)
        if (!audio) { this.finishFailure(token,message,this.manifestAvailable?'missing safety clip':'manifest unavailable',done); return }
        this.playClip(token,message,audio,done)
      }, () => { if (token === this.generation) this.finishFailure(token,message,'manifest unavailable',done) })
      return
    }
    if(this.options.resolveDynamic)void this.speakDynamic(token,message,done)
    else this.speakNative(token,message,done)
  }

  private async speakDynamic(token:number,message:SpeechMessage,done:()=>void):Promise<void> {
    const abort=new AbortController();this.dynamicAbort=abort
    this.timer=setTimeout(()=>{abort.abort();this.finishFailure(token,message,'local synthesis timeout',done)},this.options.dynamicTimeoutMs??35000)
    try {
      const result=await this.options.resolveDynamic!(message,abort.signal)
      if(token!==this.generation){result?.release();return}
      if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined
      if(!result){this.speakNative(token,message,done);return}
      this.dynamicRelease=result.release
      this.playClip(token,message,this.createAudio(result.url),done,this.options.dynamicCompletionTimeoutMs??65000)
    }catch(error){this.finishFailure(token,message,error instanceof Error?error.message:'local synthesis failed',done)}
  }

  private playClip(token:number,message:SpeechMessage,audio:BrowserAudio,done:()=>void,completionMs=this.completionTimeoutMs):void {
    try {
      this.currentAudio = audio
      audio.currentTime = 0
      audio.onplaying = () => { if (token === this.generation) this.options.onStart?.(message) }
      audio.onended = () => this.finish(token,done)
      audio.onerror = () => this.finishFailure(token,message,'media error',done)
      this.timer = setTimeout(() => this.finishFailure(token,message,'completion timeout',done),completionMs)
      void audio.play().catch(() => this.finishFailure(token,message,'play rejected',done))
    } catch { this.finishFailure(token,message,'play threw',done) }
  }

  private speakNative(token:number,message:SpeechMessage,done:()=>void):void {
    if (!this.synth || !this.createUtterance) { this.finishFailure(token,message,'native synthesis unavailable',done); return }
    try {
    const utterance=this.createUtterance(message.text)
    utterance.lang='en-US';utterance.rate=message.priority>=2?1.15:1.05
    let seed=0;for(const c of message.speaker??'safety')seed=(seed*31+c.charCodeAt(0))|0
    const voice=englishVoice(this.synth.getVoices(),seed);if(voice)utterance.voice=voice
    utterance.onstart=()=>{
      if(token!==this.generation)return
      if(this.timer!==undefined)clearTimeout(this.timer)
      this.options.onStart?.(message)
      this.timer=setTimeout(()=>this.finishFailure(token,message,'completion timeout',done),this.completionTimeoutMs)
    }
    utterance.onend=()=>this.finish(token,done)
    utterance.onerror=()=>this.finishFailure(token,message,'native synthesis error',done)
    this.timer=setTimeout(()=>{this.synth?.cancel();this.finishFailure(token,message,'start timeout',done)},this.startTimeoutMs)
    this.synth.speak(utterance)
    } catch { this.finishFailure(token,message,'native synthesis threw',done) }
  }

  private finish(token:number,done:()=>void):void {
    if(token!==this.generation)return
    ++this.generation
    if(this.timer!==undefined)clearTimeout(this.timer)
    if(this.currentAudio)this.currentAudio.onplaying=this.currentAudio.onended=this.currentAudio.onerror=null
    this.dynamicAbort?.abort();this.dynamicAbort=undefined
    this.dynamicRelease?.();this.dynamicRelease=undefined
    this.timer=undefined;this.currentAudio=undefined;done()
  }

  private finishFailure(token:number,message:SpeechMessage,reason:string,done:()=>void):void {
    if(token!==this.generation)return
    this.options.onFailure?.(message,reason)
    if(this.currentAudio){
      this.currentAudio.onplaying=this.currentAudio.onended=this.currentAudio.onerror=null
      this.currentAudio.pause()
      try { this.currentAudio.currentTime=0 } catch { /* already stopped */ }
      this.currentAudio=undefined
    }
    try { this.synth?.cancel() } catch { /* unavailable native engine */ }
    this.finish(token,done)
  }
}
