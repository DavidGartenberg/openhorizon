import {describe,it,expect,vi} from 'vitest'
import {PushToTalk,normalizeAviation} from '../src/voice/ptt'
import {encodeWav} from '../src/voice/recorder'
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function setup(){const captured=deferred<Blob>(),recognized=deferred<string>();const stop=vi.fn(()=>captured.promise),cancel=vi.fn(),send=vi.fn(),suspend=vi.fn();let context='KSFO:118.7';const ptt=new PushToTalk({capture:async()=>({stop,cancel}),transcribe:()=>recognized.promise,send,suspend,context:()=>context,allowed:()=>true});return {ptt,captured,recognized,stop,cancel,send,suspend,context:(x:string)=>context=x}}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
describe('push to talk',()=>{
 it('records only while held and sends one final transcript after release',async()=>{const s=setup();s.ptt.hold('key',true);s.ptt.hold('key',true);await flush();expect(s.ptt.state.phase).toBe('listening');expect(s.send).not.toHaveBeenCalled();s.ptt.hold('key',false);expect(s.stop).toHaveBeenCalledTimes(1);s.captured.resolve(new Blob(['wav']));await flush();expect(s.ptt.state.phase).toBe('processing');s.recognized.resolve('ready for departure runway two seven');await flush();expect(s.send).toHaveBeenCalledExactlyOnceWith('ready for departure runway 27');expect(s.ptt.state.phase).toBe('transcript');expect(s.suspend.mock.calls).toEqual([[true],[false]])})
 it('waits for all physical holds, including hardware release',async()=>{const s=setup();s.ptt.hold('key',true);s.ptt.hold('gamepad',true);await flush();s.ptt.hold('key',false);expect(s.stop).not.toHaveBeenCalled();s.ptt.hold('gamepad',false);expect(s.stop).toHaveBeenCalledTimes(1)})
 it('discards results after cancel or frequency/flight change',async()=>{for(const change of ['cancel','frequency']){const s=setup();s.ptt.hold('key',true);await flush();s.ptt.hold('key',false);s.captured.resolve(new Blob(['wav']));await flush();if(change==='cancel')s.ptt.cancel();else s.context('KJFK:123');s.recognized.resolve('ready for departure');await flush();expect(s.send).not.toHaveBeenCalled()}})
 it('releases during permission request without recording or transmitting',async()=>{const ready=deferred<any>();const cancel=vi.fn(),send=vi.fn();const p=new PushToTalk({capture:()=>ready.promise,transcribe:async()=>'',send,suspend:vi.fn(),context:()=>'',allowed:()=>true});p.hold('pointer',true);p.hold('pointer',false);ready.resolve({cancel,stop:vi.fn()});await flush();expect(cancel).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();expect(p.state.phase).toBe('idle')})
 it('reports permission errors and no speech without inventing a command',async()=>{const p=new PushToTalk({capture:async()=>{throw new DOMException('Denied','NotAllowedError')},transcribe:async()=>'',send:vi.fn(),suspend:vi.fn(),context:()=>'',allowed:()=>true});p.hold('key',true);await flush();expect(p.state.phase).toBe('error');expect(p.state.message).toMatch(/microphone/i);const s=setup();s.ptt.hold('key',true);await flush();s.ptt.hold('key',false);s.captured.resolve(new Blob());await flush();s.recognized.resolve('');await flush();expect(s.send).not.toHaveBeenCalled();expect(s.ptt.state.message).toMatch(/no speech/i)})
 it('bounds capture and requires releasing before starting again',async()=>{vi.useFakeTimers();try{const s=setup();s.ptt.hold('key',true);await flush();vi.advanceTimersByTime(20000);expect(s.cancel).toHaveBeenCalledOnce();expect(s.ptt.state.phase).toBe('error');s.ptt.hold('key',true);await flush();expect(s.ptt.state.phase).toBe('error');s.ptt.hold('key',false);s.ptt.hold('key',true);await flush();expect(s.ptt.state.phase).toBe('listening');s.ptt.cancel()}finally{vi.useRealTimers()}})
 it('blocks capture when paused/unavailable',async()=>{const capture=vi.fn();const p=new PushToTalk({capture,transcribe:async()=>'',send:vi.fn(),suspend:vi.fn(),context:()=>'',allowed:()=>false});p.hold('key',true);expect(capture).not.toHaveBeenCalled();expect(p.state.phase).toBe('error')})
})
describe('aviation audio',()=>{
 it('normalizes only bounded runway numbers and explicit altitude units',()=>{expect(normalizeAviation('runway two seven left, maintain three thousand feet')).toBe('runway 27L, maintain 3000 feet');expect(normalizeAviation('maybe to seven or runway forty')).toBe('maybe to seven or runway forty')})
 it('encodes real mono PCM samples at 16 kHz with clipped peaks',()=>{const wav=encodeWav([new Float32Array([0,2,-2,0.5])],16000);const v=new DataView(wav);expect(v.getUint32(24,true)).toBe(16000);expect(v.getUint32(40,true)).toBe(8);expect(v.getInt16(46,true)).toBe(32767);expect(v.getInt16(48,true)).toBe(-32768)})
 it('resamples 48 kHz to 16 kHz without changing duration',()=>{const v=new DataView(encodeWav([new Float32Array(48000).fill(.1)],48000));expect(v.getUint32(40,true)).toBe(32000)})
})
it('late release flush cannot detach a replacement microphone session',async()=>{
 const old=deferred<Blob>(),newCancel=vi.fn();let captures=0
 const p=new PushToTalk({capture:async()=>++captures===1?{stop:()=>old.promise,cancel:vi.fn()}:{stop:async()=>new Blob(),cancel:newCancel},transcribe:async()=>'',send:vi.fn(),suspend:vi.fn(),allowed:()=>true,context:()=>''})
 p.hold('key',true);await flush();p.hold('key',false);p.reset();p.hold('pointer',true);await flush();old.resolve(new Blob());await flush();p.cancel();expect(newCancel).toHaveBeenCalledOnce()
})
it('normalizes explicit NATO registration and numeric runway side without guessing aircraft names',()=>{
 expect(normalizeAviation('Sessna November one two three Alpha Bravo, holding short runway 27 left')).toBe('Sessna N123AB, holding short runway 27L')
 expect(normalizeAviation('November rain, runway 99 left')).toBe('November rain, runway 99 left')
})
it('continuous hardware polling needs release before rearm after reset, blur or reconnect',async()=>{
 const capture=vi.fn(async()=>({stop:async()=>new Blob(),cancel:vi.fn()}));let eligible=true
 const p=new PushToTalk({capture,transcribe:async()=>'',send:vi.fn(),suspend:vi.fn(),allowed:()=>eligible,context:()=>''})
 p.poll('gamepad',false);p.poll('gamepad',true);await flush();expect(capture).toHaveBeenCalledTimes(1)
 p.reset();for(let i=0;i<5;i++)p.poll('gamepad',true);expect(capture).toHaveBeenCalledTimes(1)
 p.poll('gamepad',false);p.poll('gamepad',true);await flush();expect(capture).toHaveBeenCalledTimes(2)
 eligible=false;p.checkContext();p.reset();p.poll('gamepad',true);eligible=true;p.poll('gamepad',true);expect(capture).toHaveBeenCalledTimes(2)
 p.poll('gamepad',null);p.poll('gamepad',true);expect(capture).toHaveBeenCalledTimes(2)
 p.poll('gamepad',false);p.poll('gamepad',true);await flush();expect(capture).toHaveBeenCalledTimes(3);p.reset()
})
it('first connected hardware state held cannot start recording until release',()=>{
 const capture=vi.fn();const p=new PushToTalk({capture,transcribe:async()=>'',send:vi.fn(),suspend:vi.fn(),allowed:()=>true,context:()=>''})
 p.poll('gamepad',true);p.poll('gamepad',true);expect(capture).not.toHaveBeenCalled()
})
