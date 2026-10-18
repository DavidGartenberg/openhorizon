import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {BrowserSpeechDriver, STATIC_SAFETY_PHRASES, type BrowserAudio} from '../src/audio/browser-speech'

class FakeAudio implements BrowserAudio {
  preload = ''
  currentTime = 0
  src = ''
  onplaying: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  plays = 0
  pauses = 0
  play(): Promise<void> { this.plays++; return Promise.resolve() }
  pause(): void { this.pauses++ }
}

const manifest = Object.fromEntries(STATIC_SAFETY_PHRASES.map((phrase) => [phrase, `/audio/safety/${phrase.toLowerCase().replaceAll(/[^a-z]+/g, '-')}.wav`]))

function rig(resolveManifest: () => Promise<Record<string, string>> = async () => manifest) {
  const audioByUrl = new Map<string, FakeAudio>()
  const starts: string[] = []
  const failures: string[] = []
  const synth = {
    cancel: vi.fn(), speak: vi.fn(), getVoices: () => [{lang:'en-US', name:'Test'}],
  }
  const driver = new BrowserSpeechDriver({
    resolveManifest,
    createAudio: (url) => { const audio = new FakeAudio(); audio.src=url; audioByUrl.set(url,audio); return audio },
    speechSynthesis: synth,
    createUtterance: (text) => ({text, lang:'', rate:1, onstart:null, onend:null, onerror:null}),
    onStart: (message) => starts.push(message.text),
    onFailure: (message, reason) => failures.push(`${message.text}:${reason}`),
    manifestTimeoutMs: 1000,
  })
  return {driver,audioByUrl,starts,failures,synth}
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('routes every allowlisted safety phrase to a reusable preloaded clip and completes on ended', async () => {
  const r=rig(); await r.driver.ready
  expect(r.audioByUrl.size).toBe(STATIC_SAFETY_PHRASES.length)
  expect([...r.audioByUrl.values()].every(a=>a.preload==='auto')).toBe(true)
  const done=vi.fn();r.driver.speak({text:'PULL UP',priority:4},done)
  const audio=r.audioByUrl.get('/audio/safety/pull-up.wav')!
  await Promise.resolve();audio.onplaying?.();audio.onended?.()
  expect(r.starts).toEqual(['PULL UP']);expect(done).toHaveBeenCalledOnce()
  expect(audio.onplaying).toBeNull();expect(audio.onended).toBeNull();expect(audio.onerror).toBeNull()
  r.driver.speak({text:'PULL UP',priority:4},vi.fn());await Promise.resolve()
  expect(audio.plays).toBe(2);expect(r.audioByUrl.size).toBe(STATIC_SAFETY_PHRASES.length)
})

it('cancellation prevents a late manifest result from starting audio', async () => {
  let resolve!: (value:Record<string,string>)=>void
  const r=rig(()=>new Promise(ok=>{resolve=ok}));const done=vi.fn()
  r.driver.speak({text:'TRAFFIC, TRAFFIC',priority:2},done);r.driver.cancel();resolve(manifest)
  await Promise.resolve();await Promise.resolve()
  expect([...r.audioByUrl.values()].some(a=>a.plays>0)).toBe(false);expect(done).not.toHaveBeenCalled()
})

it('releases ownership with a failure on clip error and clip stall', async () => {
  const r=rig();await r.driver.ready
  const failed=vi.fn();r.driver.speak({text:'TERRAIN AHEAD',priority:2},failed);await Promise.resolve()
  r.audioByUrl.get('/audio/safety/terrain-ahead.wav')!.onerror?.()
  expect(failed).toHaveBeenCalledOnce();expect(r.failures.at(-1)).toContain('media error')
  expect(r.audioByUrl.get('/audio/safety/terrain-ahead.wav')!.pauses).toBe(1)
  const stalled=vi.fn();r.driver.speak({text:'BANK ANGLE',priority:2},stalled);await Promise.resolve()
  await vi.advanceTimersByTimeAsync(15_001)
  expect(stalled).toHaveBeenCalledOnce();expect(r.failures.at(-1)).toContain('completion timeout')
})

it('bounds a manifest that never settles and releases the warning owner', async () => {
  const r=rig(()=>new Promise(()=>{}));const done=vi.fn()
  r.driver.speak({text:'PULL UP',priority:4},done)
  await vi.advanceTimersByTimeAsync(1001)
  expect(done).toHaveBeenCalledOnce();expect(r.failures.at(-1)).toContain('manifest unavailable')
})

it('converts synchronous media exceptions to bounded failure', async () => {
  const r=rig();await r.driver.ready
  const audio=r.audioByUrl.get('/audio/safety/pull-up.wav')!
  audio.play=()=>{throw new Error('bad media')}
  const done=vi.fn();expect(()=>r.driver.speak({text:'PULL UP',priority:4},done)).not.toThrow()
  await Promise.resolve();expect(done).toHaveBeenCalledOnce();expect(r.failures.at(-1)).toContain('play threw')
})

it('ignores stale play rejection and playing callbacks after the reusable clip is restarted', async () => {
  const r=rig();await r.driver.ready
  const audio=r.audioByUrl.get('/audio/safety/pull-up.wav')!
  let reject!:()=>void;audio.play=()=>new Promise((_ok,no)=>{reject=()=>no(new Error('late'))})
  const oldDone=vi.fn();r.driver.speak({text:'PULL UP',priority:4},oldDone);await Promise.resolve()
  const stalePlaying=audio.onplaying;r.driver.cancel()
  audio.play=()=>Promise.resolve();const newDone=vi.fn();r.driver.speak({text:'PULL UP',priority:4},newDone);await Promise.resolve()
  reject();stalePlaying?.();await Promise.resolve()
  expect(oldDone).not.toHaveBeenCalled();expect(newDone).not.toHaveBeenCalled();expect(r.starts).toEqual([])
})

it('bounds native synthesis start and completion stalls without late success', async () => {
  const r=rig();await r.driver.ready
  const startStall=vi.fn();r.driver.speak({text:'arbitrary radio',priority:0},startStall)
  await vi.advanceTimersByTimeAsync(2_001)
  expect(startStall).toHaveBeenCalledOnce();expect(r.failures.at(-1)).toContain('start timeout')
  const completeStall=vi.fn();r.driver.speak({text:'another transmission',priority:0},completeStall)
  const utterance=r.synth.speak.mock.calls.at(-1)![0];utterance.onstart?.()
  await vi.advanceTimersByTimeAsync(15_001)
  expect(completeStall).toHaveBeenCalledOnce();expect(r.failures.at(-1)).toContain('completion timeout')
  utterance.onend?.();expect(completeStall).toHaveBeenCalledOnce()
})

it('cancels active media and ignores stale ended callbacks', async () => {
  const r=rig();await r.driver.ready
  const stale=vi.fn();r.driver.speak({text:'FIFTY',priority:1},stale);await Promise.resolve()
  const audio=r.audioByUrl.get('/audio/safety/fifty.wav')!;const oldEnd=audio.onended
  r.driver.cancel();oldEnd?.()
  expect(audio.pauses).toBe(1);expect(stale).not.toHaveBeenCalled()
})

it('plays dynamic local WAV and releases its object URL on completion',async()=>{
 const release=vi.fn(),audio=new FakeAudio(),done=vi.fn()
 const driver=new BrowserSpeechDriver({resolveManifest:async()=>({}),resolveDynamic:async()=>({url:'blob:reply',release}),createAudio:()=>audio})
 driver.speak({text:'N123AB, cleared to land',priority:0},done);await Promise.resolve();await Promise.resolve()
 expect(audio.plays).toBe(1);audio.onended?.();expect(done).toHaveBeenCalledOnce();expect(release).toHaveBeenCalledOnce()
})
it('aborts stale dynamic synthesis and releases even a late object URL',async()=>{
 let resolve!:(audio:{url:string;release:()=>void})=>void;let signal!:AbortSignal
 const release=vi.fn(),audio=new FakeAudio()
 const driver=new BrowserSpeechDriver({resolveManifest:async()=>({}),resolveDynamic:(_m,s)=>{signal=s;return new Promise(ok=>{resolve=ok})},createAudio:()=>audio})
 driver.speak({text:'stale ATC',priority:0},vi.fn());driver.cancel();expect(signal.aborted).toBe(true)
 resolve({url:'blob:stale',release});await Promise.resolve();expect(audio.plays).toBe(0);expect(release).toHaveBeenCalledOnce()
})
it('reports native voice enumeration exceptions through the failure diagnostic',()=>{
 const failure=vi.fn(),done=vi.fn();const driver=new BrowserSpeechDriver({resolveManifest:async()=>({}),speechSynthesis:{speak:vi.fn(),cancel:vi.fn(),getVoices:()=>{throw new Error('engine')}} ,createUtterance:()=>({lang:'',rate:1,onstart:null,onend:null,onerror:null}),onFailure:failure})
 expect(()=>driver.speak({text:'test voice',priority:0},done)).not.toThrow();expect(failure).toHaveBeenCalledOnce();expect(done).toHaveBeenCalledOnce()
})
