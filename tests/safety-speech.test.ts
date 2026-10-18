import { expect, it } from 'vitest'
import { SafetySpeechController, englishVoice } from '../src/audio/safety-speech'
function rig(){ const said:string[]=[];const ends:Array<()=>void>=[];let cancelled=0;const c=new SafetySpeechController({speak:(m,end)=>{said.push(m.text);ends.push(end)},cancel:()=>{cancelled++}});return {c,said,ends,cancelled:()=>cancelled} }
it('terrain inhibits TCAS and interrupts radio, persistent warning repeats without backlog',()=>{
 const r=rig();r.c.radio('hello',0);r.c.update(0,{text:'PULL UP',priority:4},{text:'CLIMB',priority:3});expect(r.said).toEqual(['hello','PULL UP']);r.c.update(1000,{text:'PULL UP',priority:4},{text:'CLIMB',priority:3});expect(r.said.length).toBe(2);r.ends[0]!();r.c.radio('stale',1100);expect(r.said.length).toBe(2);r.ends[1]!();r.c.update(5000,{text:'PULL UP',priority:4});expect(r.said.at(-1)).toBe('PULL UP')
})
it('PTT suspension drops radio but retains critical alerts; reset invalidates callbacks',()=>{
 const r=rig();r.c.radio('old',0);r.c.setRadioSuspended(true);r.c.radio('drop',1);r.c.update(2,undefined,{text:'CLIMB',priority:3});expect(r.said).toEqual(['old','CLIMB']);r.c.reset();r.ends[1]!();r.c.setRadioSuspended(false);r.c.radio('new',3);expect(r.said.at(-1)).toBe('new')
})
it('resolved hazard cancels active speech and mute purges radio',()=>{
 const r=rig();r.c.update(0,{text:'TERRAIN',priority:4});r.c.update(500);expect(r.cancelled()).toBe(1);r.c.radio('a',1000);r.c.radio('b',1001);r.c.setMuted(true);r.c.setMuted(false);r.ends.at(-1)!();expect(r.said).toEqual(['TERRAIN','a'])
})
it('English voice selection never hashes to unrelated language',()=>expect(englishVoice([{lang:'fr-FR'},{lang:'en-GB'},{lang:'de-DE'}],7)?.lang).toBe('en-GB'))
it('height callout interrupts radio and clearance finishes across empty updates',()=>{
 const r=rig();r.c.radio('long ATC',0);r.c.update(100,undefined,undefined,'FIFTY');expect(r.said.at(-1)).toBe('FIFTY');r.ends.at(-1)!();r.c.update(500,undefined,undefined,'CLEAR OF CONFLICT');const n=r.cancelled();r.c.update(1000);expect(r.cancelled()).toBe(n);expect(r.said.at(-1)).toBe('CLEAR OF CONFLICT')
})
it('clearance one-shot can finish while residual TA becomes current',()=>{
 const r=rig();r.c.update(0,undefined,undefined,'CLEAR OF CONFLICT');r.c.update(500,undefined,{text:'TRAFFIC',priority:2});expect(r.cancelled()).toBe(0);expect(r.said).toEqual(['CLEAR OF CONFLICT']);r.ends[0]!();r.c.update(1000,undefined,{text:'TRAFFIC',priority:2});expect(r.said.at(-1)).toBe('TRAFFIC')
})
it('radio backlog is bounded and expires before delivery',()=>{
 const r=rig();r.c.radio('a',0);for(let i=0;i<10;i++)r.c.radio(String(i),i);r.ends[0]!();r.c.update(9000);expect(r.said).toEqual(['a'])
})
it('PTT cancels active copilot and suppresses new copilot while retaining height callouts',()=>{
 const r=rig();r.c.copilot('V1');r.c.setRadioSuspended(true);expect(r.cancelled()).toBe(1);expect(r.c.copilot('rotate')).toBe(false);r.c.update(1,undefined,undefined,'FIFTY');expect(r.said).toEqual(['V1','FIFTY'])
})
it('marks already playing safety audio as blocking capture, but not copilot',()=>{
 const r=rig();r.c.copilot('rotate');expect(r.c.captureBlocked).toBe(false);r.c.reset();r.c.update(0,{text:'PULL UP',priority:4});expect(r.c.captureBlocked).toBe(true);r.ends.at(-1)!();expect(r.c.captureBlocked).toBe(false)
})
