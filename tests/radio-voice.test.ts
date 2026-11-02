import {describe,expect,it} from 'vitest'
import {applyRadioFilter,chainFor,encodeWav16,softClipCurve,voiceRoleFor} from '../src/audio/radio-voice'
// @ts-expect-error server ESM
import {pickVoice} from '../server/voice.mjs'

describe('radio voice', () => {
  it('assigns roles by who is speaking', () => {
    expect(voiceRoleFor({text:'cleared to land',priority:0,speaker:'KSFO Tower'})).toBe('atc')
    expect(voiceRoleFor({text:'rotate',priority:1,speaker:'first-officer'})).toBe('copilot')
    expect(voiceRoleFor({text:'PULL UP',priority:3})).toBe('warning')
  })
  it('encodes a valid mono PCM16 WAV the speech server would also accept', () => {
    const wav = new DataView(encodeWav16(new Float32Array([0, 1, -1, 2, -2]), 16000))
    expect(wav.getUint32(4,true)+8).toBe(wav.byteLength)
    expect(wav.getUint16(22,true)).toBe(1)
    expect(wav.getUint32(24,true)).toBe(16000)
    expect(wav.getInt16(46,true)).toBe(0x7fff)
    expect(wav.getInt16(48,true)).toBe(-0x8000)
    expect(wav.getInt16(50,true)).toBe(0x7fff) // out-of-range input clips, never wraps
  })
  it('soft clip is odd, bounded, and monotonic', () => {
    const c = softClipCurve(2.6, 257)
    expect(c[0]).toBeCloseTo(-1,6); expect(c[256]).toBeCloseTo(1,6); expect(c[128]).toBeCloseTo(0,6)
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i-1]!)
  })
  it('never silences a transmission: no WebAudio returns the clean clip', async () => {
    const clip = new Blob([new Uint8Array(100)])
    expect(await applyRadioFilter(clip,'atc')).toBe(clip)
    expect(await applyRadioFilter(clip,'warning')).toBe(clip)
  })
  it('picks stable, distinct-by-role voices on the server', () => {
    expect(pickVoice('atc','KSFO Tower')).toEqual(pickVoice('atc','KSFO Tower'))
    expect(pickVoice('warning').voice).toBe('Samantha')
    expect(pickVoice('copilot').voice).not.toBe(pickVoice('warning').voice)
    expect(pickVoice('nonsense').voice).toBe('Samantha')
    const atcVoices = new Set(['KSFO Tower','KSFO Ground','NorCal Approach','KOAK Tower','Clearance'].map(s => pickVoice('atc',s).voice))
    expect(atcVoices.size).toBeGreaterThan(1)
    // a controller must never sound like the first officer
    for (const f of ['KSFO Tower','KSFO Ground','NorCal Approach','KOAK Tower','Clearance','Oakland Center','A','B','C','D','E','F']) expect(pickVoice('atc',f).voice).not.toBe(pickVoice('copilot').voice)
  })
  it('voices other aircraft, the ATIS and controllers each in their own role, defaulting to a controller',()=>{
    expect(voiceRoleFor({text:'x',priority:0,speaker:'Skyhawk 123AB',role:'pilot'})).toBe('pilot')
    expect(voiceRoleFor({text:'x',priority:0,speaker:'KSFO ATIS',role:'atis'})).toBe('atis')
    expect(voiceRoleFor({text:'x',priority:0,speaker:'Palo Alto Tower',role:'atc'})).toBe('atc')
    expect(voiceRoleFor({text:'x',priority:0})).toBe('atc')
    expect(voiceRoleFor({text:'x',priority:1,speaker:'first-officer',role:'pilot'})).toBe('copilot')
    expect(voiceRoleFor({text:'x',priority:3,role:'pilot'})).toBe('warning')
  })
  it('makes each aircraft a little different on the air, always the same way for the same one',()=>{
    expect(chainFor('pilot','N77GA')).toEqual(chainFor('pilot','N77GA'))
    const chains=Array.from({length:30},(_,i)=>chainFor('pilot',`Skyhawk ${i}AB`))
    expect(new Set(chains.map(c=>c.noise.toFixed(4))).size).toBeGreaterThan(10)
    const quiet=chainFor('atc','Palo Alto Tower')
    for(const c of chains){expect(c.noise).toBeGreaterThan(quiet.noise*0.5);expect(c.lowpass).toBeLessThanOrEqual(2700);expect(c.gain).toBeLessThan(quiet.gain+0.05)}
    expect(chainFor('atc','anyone')).toEqual(chainFor('atc','someone else'))
  })
})
