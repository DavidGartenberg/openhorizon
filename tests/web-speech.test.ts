import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureWebSpeech, joinTranscript, webSpeechAvailable, webSpeechErrorMessage } from '../src/voice/web-speech'
import { PushToTalk } from '../src/voice/ptt'

/** A scripted stand-in for the browser's SpeechRecognition. */
class FakeRecognition {
  static last: FakeRecognition
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 0
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null
  started = false; stopped = false; aborted = false
  constructor() { FakeRecognition.last = this }
  start(): void { this.started = true; queueMicrotask(() => this.onstart?.()) }
  stop(): void { this.stopped = true; queueMicrotask(() => this.onend?.()) }
  abort(): void { this.aborted = true }
  say(parts: Array<[string, boolean]>): void {
    this.onresult?.({ resultIndex: 0, results: parts.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } })) })
  }
}
const install = (): void => { (globalThis as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition }
afterEach(() => { delete (globalThis as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition })

describe('helpers', () => {
  it('joins finished and in-flight segments cleanly', () => {
    expect(joinTranscript(['tower  cessna', 'one two three'], 'ready for departure')).toBe('tower cessna one two three ready for departure')
    expect(joinTranscript([], '')).toBe('')
    expect(joinTranscript(['  '], ' hello ')).toBe('hello')
  })
  it('explains every error in plain words', () => {
    expect(webSpeechErrorMessage('not-allowed')).toMatch(/permission/i)
    expect(webSpeechErrorMessage('no-speech')).toMatch(/No speech/)
    expect(webSpeechErrorMessage('network')).toMatch(/connection/)
    expect(webSpeechErrorMessage('audio-capture')).toMatch(/microphone/i)
    expect(webSpeechErrorMessage('weird')).toMatch(/weird/)
  })
  it('detects the API', () => {
    expect(webSpeechAvailable()).toBe(false)
    install()
    expect(webSpeechAvailable()).toBe(true)
  })
})

describe('captureWebSpeech', () => {
  it('recognizes while held and returns the final text on release, streaming interim captions', async () => {
    install()
    const seen: string[] = []
    const cap = await captureWebSpeech(new AbortController().signal, (t) => seen.push(t))
    const rec = FakeRecognition.last
    expect(rec.started).toBe(true)
    expect(rec.lang).toBe('en-US'); expect(rec.continuous).toBe(true); expect(rec.interimResults).toBe(true)
    rec.say([['tower', false]])
    rec.say([['tower cessna one two three', true], ['ready for', false]])
    expect(seen).toEqual(['tower', 'tower cessna one two three ready for'])
    rec.say([['tower cessna one two three', true], ['ready for departure', true]])
    const text = await cap.stop()
    expect(rec.stopped).toBe(true)
    expect(text).toContain('ready for departure')
  })

  it('fails honestly with nothing heard, and surfaces the service error', async () => {
    install()
    const quiet = await captureWebSpeech(new AbortController().signal)
    await expect(quiet.stop()).rejects.toThrow(/No speech heard/)
    const broken = await captureWebSpeech(new AbortController().signal)
    FakeRecognition.last.onerror?.({ error: 'network' })
    await expect(broken.stop()).rejects.toThrow(/connection/)
  })

  it('reports a denied microphone as a permission error', async () => {
    install()
    class Denied extends FakeRecognition { start(): void { queueMicrotask(() => this.onerror?.({ error: 'not-allowed' })) } }
    ;(globalThis as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Denied
    await expect(captureWebSpeech(new AbortController().signal)).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('aborts recognition when cancelled', async () => {
    install()
    const ctl = new AbortController()
    await captureWebSpeech(ctl.signal)
    ctl.abort()
    expect(FakeRecognition.last.aborted).toBe(true)
  })

  it('is refused cleanly where the browser has no speech recognition', async () => {
    await expect(captureWebSpeech(new AbortController().signal)).rejects.toThrow(/unavailable/)
  })
})

describe('push-to-talk with browser speech', () => {
  it('sends the recognized text without a transcription step, normalized for the controller', async () => {
    install()
    const send = vi.fn()
    const transcribe = vi.fn(async () => 'SHOULD NOT BE USED')
    const ptt = new PushToTalk({
      capture: (signal) => captureWebSpeech(signal), transcribe, send, suspend: vi.fn(), context: () => 'ctx', allowed: () => true,
    })
    ptt.hold('key', true)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(ptt.state.phase).toBe('listening')
    FakeRecognition.last.say([['request taxi to runway two eight left', true]])
    ptt.hold('key', false)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(transcribe).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('request taxi to runway 28L')
    expect(ptt.state.phase).toBe('transcript')
  })
})

describe('click-to-talk (hands-free)', () => {
  it('sends the transmission by itself when the recognizer finishes, no release needed', async () => {
    install()
    const send = vi.fn()
    let ptt!: PushToTalk
    ptt = new PushToTalk({
      capture: (signal) => captureWebSpeech(signal, undefined, () => ptt.hold('toggle', false)),
      transcribe: async () => '', send, suspend: vi.fn(), context: () => 'ctx', allowed: () => true,
    })
    ptt.hold('toggle', true) // the toolbar button
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(ptt.state.phase).toBe('listening')
    FakeRecognition.last.say([['ready for departure runway two eight left', true]])
    FakeRecognition.last.onend?.() // the browser decides the speaker is done
    for (let i = 0; i < 30; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('ready for departure runway 28L')
  })

  it('does not fire the hands-free callback when WE stop it', async () => {
    install()
    const ended = vi.fn()
    const cap = await captureWebSpeech(new AbortController().signal, undefined, ended)
    FakeRecognition.last.say([['hello', true]])
    await cap.stop()
    expect(ended).not.toHaveBeenCalled()
  })
})
