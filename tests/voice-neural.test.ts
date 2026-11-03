import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ES module without types (server code)
import { createNeuralHelper } from '../server/voice-neural.mjs'

const VOICES = [
  { id: 'com.apple.siri.natural.Nora', name: 'Voice 4', language: 'en-US', quality: 2 },
  { id: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', language: 'en-US', quality: 1 },
  { id: 'com.apple.voice.Aman.premium', name: 'Aman', language: 'en-IN', quality: 2 },
]

/** A stand-in for the Swift helper: speaks the same one-line-JSON protocol. */
function fakeHelper(handle: (message: any, reply: (o: object) => void, child: any) => void, { silent = false } = {}) {
  const spawned: any[] = []
  const spawn = (_command: string, _args: string[]) => {
    const child: any = new EventEmitter()
    child.stdout = new PassThrough()
    child.stdin = { write: (line: string) => { const m = JSON.parse(line); handle(m, (o) => child.stdout.write(`${JSON.stringify(o)}\n`), child) } }
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit')) }
    spawned.push(child)
    if (!silent) setImmediate(() => child.stdout.write('{"ready":true}\n'))
    return child
  }
  return { spawn, spawned }
}

const standard = (message: any, reply: (o: object) => void) => {
  if (message.op === 'list') reply({ ok: true, id: message.id, voices: VOICES })
  else if (message.op === 'speak') reply(message.voice === 'nope' ? { ok: false, error: 'no such voice' } : { ok: true, seconds: 1.5 })
}

describe('the neural voices\' helper', () => {
  it('starts on first use, lists only the Premium / natural voices, and keeps the list', async () => {
    const { spawn, spawned } = fakeHelper(standard)
    const helper = createNeuralHelper({ enabled: true, spawn })
    expect(spawned).toHaveLength(0)
    const voices = await helper.voices()
    expect(voices.map((v: { name: string }) => v.name)).toEqual(['Voice 4', 'Aman'])
    await helper.voices()
    expect(spawned).toHaveLength(1)
    helper.close()
  })

  it('renders speech through the helper, in order, and rejects what it refuses', async () => {
    const seen: any[] = []
    const { spawn } = fakeHelper((m, reply) => { seen.push(m); standard(m, reply) })
    const helper = createNeuralHelper({ enabled: true, spawn })
    const [a, b] = await Promise.all([
      helper.speak({ voice: 'com.apple.siri.natural.Nora', rate: 0.52, pitch: 1, text: 'first' }, '/tmp/a.wav'),
      helper.speak({ voice: 'com.apple.voice.Aman.premium', rate: 0.4, text: 'second' }, '/tmp/b.wav'),
    ])
    expect(a.ok && b.ok).toBe(true)
    expect(seen.map((m) => m.text)).toEqual(['first', 'second'])
    expect(seen[0]).toMatchObject({ op: 'speak', voice: 'com.apple.siri.natural.Nora', rate: 0.52, out: '/tmp/a.wav' })
    await expect(helper.speak({ voice: 'nope', text: 'x' }, '/tmp/c.wav')).rejects.toThrow('no such voice')
    helper.close()
  })

  it('does nothing when it is off, and never starts a process', async () => {
    const { spawn, spawned } = fakeHelper(standard)
    const helper = createNeuralHelper({ enabled: false, spawn })
    expect(await helper.voices()).toEqual([])
    await expect(helper.speak({ voice: 'x', text: 'y' }, '/tmp/x.wav')).rejects.toThrow()
    helper.warm()
    expect(spawned).toHaveLength(0)
  })

  it('answers with no voices, not an error, when the helper cannot start or stops', async () => {
    const dead = createNeuralHelper({ enabled: true, spawn: () => { throw new Error('no swift') } })
    expect(await dead.voices()).toEqual([])
    const stopping = fakeHelper((_m, _reply, child) => child.emit('exit'))
    const helper = createNeuralHelper({ enabled: true, spawn: stopping.spawn })
    expect(await helper.voices()).toEqual([])
    await expect(helper.speak({ voice: 'v', text: 'x' }, '/tmp/x.wav')).rejects.toThrow()
  })

  it('kills a helper that does not answer, and starts a fresh one for the next request', async () => {
    let n = 0
    const { spawn, spawned } = fakeHelper((m, reply) => { if (m.op === 'speak' && ++n === 1) return; standard(m, reply) })
    const helper = createNeuralHelper({ enabled: true, spawn, requestTimeoutMs: 40 })
    await expect(helper.speak({ voice: 'v', text: 'hangs' }, '/tmp/x.wav')).rejects.toThrow('timed out')
    expect(spawned[0].killed).toBe(true)
    const again = await helper.speak({ voice: 'v', text: 'works' }, '/tmp/y.wav')
    expect(again.ok).toBe(true)
    expect(spawned).toHaveLength(2)
    helper.close()
  })

  it('gives up on a helper that keeps dying instead of restarting it for ever', async () => {
    const dying = fakeHelper((_m, _reply, child) => child.emit('exit'))
    const helper = createNeuralHelper({ enabled: true, spawn: dying.spawn, maxStarts: 2 })
    for (let i = 0; i < 5; i++) await helper.speak({ voice: 'v', text: 'x' }, '/tmp/x.wav').catch(() => {})
    expect(dying.spawned.length).toBeLessThanOrEqual(2)
  })

  it('does not wait for a helper that never says it is ready', async () => {
    const { spawn } = fakeHelper(standard, { silent: true })
    const helper = createNeuralHelper({ enabled: true, spawn, startTimeoutMs: 30 })
    expect(await helper.voices()).toEqual([])
  })
})
