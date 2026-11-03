/**
 * The neural voices' helper process (server/voice-neural.swift) and how the speech server talks to it.
 *
 * macOS keeps its best voices (Siri natural voices, Premium neural voices) away from `say` and from any
 * unsigned program; Apple's own `swift` interpreter can reach them. The helper is started the first time
 * it is needed and kept running (the interpreter takes seconds to start; a transmission then takes about a
 * quarter of its own length to render). Requests are one JSON line each, answered in order.
 *
 * Everything here fails soft: no `swift`, no such voices, a crashed or hung helper, and the caller carries
 * on with `say`. A helper that keeps dying is given up on rather than restarted forever.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./voice-neural.swift', import.meta.url))
/** A voice at or above this quality is a Premium / Enhanced / natural one (AVSpeechSynthesisVoiceQuality: 1 default, 2 enhanced, 3 premium). */
export const NEURAL_MIN_QUALITY = 2

export function createNeuralHelper(options = {}) {
  const swift = options.swift ?? '/usr/bin/swift'
  const script = options.script ?? SCRIPT
  const launch = options.spawn ?? ((command, args) => spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] }))
  const startTimeoutMs = options.startTimeoutMs ?? 60_000
  const requestTimeoutMs = options.requestTimeoutMs ?? 45_000
  const maxStarts = options.maxStarts ?? 4
  const enabled = options.enabled ?? (process.platform === 'darwin' && fs.existsSync(swift) && fs.existsSync(script))

  let child
  let ready
  let buffer = ''
  let starts = 0
  let givenUp = false
  /** Replies arrive in the order requests were sent. */
  const waiting = []
  let voiceList

  function fail(error) {
    for (const w of waiting.splice(0)) w.reject(error)
  }

  function start() {
    if (child) return ready
    if (givenUp || starts >= maxStarts) { givenUp = true; return Promise.reject(new Error('neural voice helper unavailable')) }
    starts++
    buffer = ''
    let proc
    try { proc = launch(swift, [script]) } catch (error) { givenUp = true; return Promise.reject(error) }
    child = proc
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('neural voice helper did not start')); stop() }, startTimeoutMs)
      proc.once('error', (error) => { clearTimeout(timer); reject(error); child = undefined; ready = undefined; fail(error) })
      proc.once('exit', () => { clearTimeout(timer); if (child === proc) { child = undefined; ready = undefined } fail(new Error('neural voice helper stopped')); reject(new Error('neural voice helper stopped')) })
      proc.stdout.on('data', (chunk) => {
        buffer += chunk
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const line = buffer.slice(0, at)
          buffer = buffer.slice(at + 1)
          let message
          try { message = JSON.parse(line) } catch { continue }
          if (message.ready) { clearTimeout(timer); resolve() } else waiting.shift()?.resolve(message)
        }
      })
    })
    ready.catch(() => {})
    return ready
  }

  function stop() {
    const proc = child
    child = undefined
    ready = undefined
    try { proc?.kill('SIGKILL') } catch { /* already gone */ }
  }

  async function request(message, timeoutMs = requestTimeoutMs) {
    await start()
    return new Promise((resolve, reject) => {
      const entry = { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } }
      // A helper that does not answer is killed (the next request starts a fresh one): its late reply must not be taken for the next one's.
      const timer = setTimeout(() => { const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); stop(); fail(new Error('neural voice helper timed out')); reject(new Error('neural voice helper timed out')) }, timeoutMs)
      waiting.push(entry)
      try { child.stdin.write(`${JSON.stringify(message)}\n`) } catch (error) { const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); reject(error) }
    })
  }

  return {
    enabled,
    /** Start the helper now so the first transmission does not wait for it. Never throws. */
    warm() { if (enabled) start().catch(() => {}) },
    /** The Premium / Enhanced / natural English voices, [{ id, name, language, quality }]; empty when there are none or no helper. Cached. */
    async voices() {
      if (!enabled) return []
      voiceList ??= request({ op: 'list' }).then((r) => (r.ok ? r.voices.filter((v) => v.quality >= NEURAL_MIN_QUALITY) : [])).catch(() => { voiceList = undefined; return [] })
      return voiceList
    },
    /** Render `text` in a neural voice to `out` (mono 16 kHz PCM WAV). Rejects on any failure; the caller falls back to `say`. */
    async speak({ voice, rate, pitch, text }, out, signal) {
      if (!enabled) throw new Error('neural voices unavailable')
      if (signal?.aborted) throw Object.assign(new Error('cancelled'), { aborted: true })
      const reply = await request({ op: 'speak', voice, rate, pitch, text, out })
      if (!reply.ok) throw new Error(reply.error || 'neural synthesis failed')
      return reply
    },
    close() { stop(); givenUp = true },
  }
}
