/** One synthesis owner. Hazards are current state, never queued utterances. */
export interface SpeechMessage { text: string; priority: number; speaker?: string }
export interface SpeechDriver { speak(message: SpeechMessage, done: () => void): void; cancel(): void }
export function englishVoice<T extends {lang: string}>(voices: readonly T[], seed = 0): T | undefined {
  const english = voices.filter(v => /^en(?:[-_]|$)/i.test(v.lang))
  return english.length ? english[Math.abs(seed) % english.length] : undefined
}
export class SafetySpeechController {
  private active?: SpeechMessage
  private hazard?: SpeechMessage
  private generation = 0
  private lastAt = -Infinity
  private lastText = ''
  private muted = false
  private suspended = false
  private queue: Array<{message: SpeechMessage; at: number}> = []
  constructor(private readonly driver: SpeechDriver) {}
  get captureBlocked():boolean {return !!this.active && this.active.priority>=1 && this.active.speaker!=='first-officer'}
  private cancel(): void { ++this.generation; this.active = undefined; this.driver.cancel() }
  reset(): void { this.cancel(); this.hazard = undefined; this.queue = []; this.lastText = ''; this.lastAt = -Infinity }
  setMuted(value: boolean): void { if (this.muted !== value) { this.muted = value; this.reset() } }
  /** PTT uses this: suspend radio and copilot; GPWS/TCAS remain available. */
  setRadioSuspended(value: boolean): void {
    this.suspended = value
    if (value) { this.queue = []; if (this.active?.priority === 0 || this.active?.speaker === 'first-officer') this.cancel() }
  }
  private start(message: SpeechMessage): void {
    const token = ++this.generation
    this.active = message
    try { this.driver.speak(message, () => { if (token === this.generation) this.active = undefined }) }
    catch { if (token === this.generation) this.active = undefined }
  }
  update(now: number, gpws?: SpeechMessage, tcas?: SpeechMessage, callout?: string): void {
    const next = gpws ?? tcas
    if (next?.text !== this.hazard?.text || next?.priority !== this.hazard?.priority) {
      if (this.active && (this.active.priority >= 2 || (next && (gpws || next.priority >= 3 || this.active.priority === 0)))) this.cancel()
      this.lastText = ''; this.lastAt = -Infinity
    }
    this.hazard = next
    if (this.muted) return
    if (next) {
      this.queue = []
      const cadence = next.priority >= 3 ? 5000 : 8000
      if (!this.active && (next.text !== this.lastText || now - this.lastAt >= cadence)) {
        this.lastText = next.text; this.lastAt = now; this.start(next)
      }
      return
    }
    if (callout && this.active?.priority === 0) { this.cancel(); this.queue = [] }
    if (callout && !this.active) this.start({text:callout,priority:1})
    this.queue = this.queue.filter(q => now - q.at < 8000)
    if (!this.active && !this.suspended) { const q = this.queue.shift(); if (q) this.start(q.message) }
  }
  radio(text: string, now: number, speaker?: string): boolean {
    if (this.muted || this.suspended || this.hazard) return false
    const message = {text,priority:0,speaker}
    if (!this.active) this.start(message)
    else { this.queue = this.queue.filter(q => now-q.at < 8000).slice(-1); this.queue.push({message,at:now}) }
    return true
  }
  copilot(text: string): boolean {
    if (this.muted || this.suspended || this.hazard || this.active) return false
    this.start({text,priority:1,speaker:'first-officer'}); return true
  }
}
