/** One synthesis owner. Hazards are current state, never queued utterances. */
export interface SpeechMessage {
  text: string
  priority: number
  speaker?: string
  /** Radio transmissions: who is talking (a facility, an aircraft, the ATIS), which decides voice and radio character. */
  role?: 'atc' | 'pilot' | 'atis'
  /** To or from the player: goes ahead of the other aircraft's traffic and survives a long wait behind it. */
  forPlayer?: boolean
  /** Background chatter: plays when the frequency is quiet and never delays, replaces or outranks a transmission to or from the player. */
  ambient?: boolean
  /** Phraseology of the airport's region ('icao' outside North America). */
  style?: 'faa' | 'icao'
  /** The words already in spoken form (numbers, callsigns, phonetic letters); the voice speaks them as they are. */
  spoken?: string
}
export interface RadioOptions { role?: SpeechMessage['role']; ambient?: boolean; forPlayer?: boolean; style?: SpeechMessage['style']; spoken?: string }
/** Transmissions waiting behind the one being spoken: a reply and a readback may follow each other. */
const MAX_QUEUED = 4
const MAX_AMBIENT_QUEUED = 6
const STALE_MS = 8000
const STALE_AMBIENT_MS = 25000
const STALE_PLAYER_MS = 30000
/** Who goes first: the player's exchange, then the other aircraft's tower traffic, then background chatter. */
const rank = (m: SpeechMessage): number => (m.forPlayer ? 0 : m.ambient ? 2 : 1)
const staleMs = (m: SpeechMessage): number => (m.forPlayer ? STALE_PLAYER_MS : m.ambient ? STALE_AMBIENT_MS : STALE_MS)
/** A pause between one transmission ending and the next beginning: nobody keys up in the same instant. */
const GAP_MS = 380
export interface SpeechDriver {
  speak(message: SpeechMessage, done: () => void): void
  cancel(): void
  /** A message is waiting its turn: the driver may render it now so it starts the moment its turn comes. */
  prepare?(message: SpeechMessage): void
}
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
  private readyAt: number | undefined
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
    this.queue = this.queue.filter(q => now - q.at < staleMs(q.message))
    if (!this.active && !this.suspended && this.queue.length) {
      this.readyAt ??= now + GAP_MS
      if (now >= this.readyAt) { this.readyAt = undefined; const q = this.queue.shift(); if (q) this.start(q.message) }
    } else if (this.active || !this.queue.length) this.readyAt = undefined
  }
  radio(text: string, now: number, speaker?: string, options: RadioOptions = {}): boolean {
    if (this.muted || this.suspended || this.hazard) return false
    const message: SpeechMessage = {
      text, priority: 0, speaker,
      ...(options.role ? { role: options.role } : {}), ...(options.ambient ? { ambient: true } : {}), ...(options.forPlayer ? { forPlayer: true } : {}),
      ...(options.style ? { style: options.style } : {}), ...(options.spoken ? { spoken: options.spoken } : {}),
    }
    if (!this.active && !this.queue.length) { this.start(message); return true }
    this.queue = this.queue.filter(q => now - q.at < staleMs(q.message))
    if (message.ambient && this.queue.filter(q => q.message.ambient).length >= MAX_AMBIENT_QUEUED) return false
    // Behind everything of equal or higher rank, ahead of what ranks lower (stable: a reply never overtakes the call before it).
    let at = this.queue.length
    while (at > 0 && rank(this.queue[at - 1]!.message) > rank(message)) at--
    this.queue.splice(at, 0, { message, at: now })
    const real = this.queue.filter(q => !q.message.ambient)
    if (real.length > MAX_QUEUED) {
      const drop = real.find(q => !q.message.forPlayer) ?? real[0]!
      this.queue.splice(this.queue.indexOf(drop), 1)
      if (drop.message === message) return false
    }
    try { this.driver.prepare?.(message) } catch { /* rendering ahead is an optimization */ }
    return true
  }
  copilot(text: string): boolean {
    if (this.muted || this.suspended || this.hazard || this.active) return false
    this.start({text,priority:1,speaker:'first-officer'}); return true
  }
}
