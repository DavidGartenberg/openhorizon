import { expect, it } from 'vitest'
import { SafetySpeechController, englishVoice } from '../src/audio/safety-speech'
function rig(){ const said:string[]=[];const messages:Array<Parameters<SafetySpeechController['radio']>[3]&{text:string;ambient?:boolean;speaker?:string}>=[];const prepared:string[]=[];const ends:Array<()=>void>=[];let cancelled=0;const c=new SafetySpeechController({speak:(m,end)=>{said.push(m.text);messages.push(m);ends.push(end)},cancel:()=>{cancelled++},prepare:m=>{prepared.push(m.text)}});return {c,said,messages,prepared,ends,cancelled:()=>cancelled} }
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

it('puts transmissions to or from the player ahead of background chatter that has not started, never ahead of the one being spoken',()=>{
 const r=rig();r.c.radio('first',0,'Palo Alto Ground',{role:'atc'})
 r.c.radio('chatter 1',10,'Skylane 6EK',{role:'pilot',ambient:true});r.c.radio('chatter 2',20,'Palo Alto Ground',{role:'atc',ambient:true})
 r.c.radio('reply to me',30,'Palo Alto Ground',{role:'atc'})
 r.ends[0]!();r.c.update(1000);r.c.update(2000);r.ends[1]!();r.c.update(3000);r.c.update(4000);r.ends[2]!();r.c.update(5000);r.c.update(6000)
 expect(r.said).toEqual(['first','reply to me','chatter 1','chatter 2'])
})

it('lets a reply and a readback follow each other, drops the oldest real transmission past four, and keeps background chatter from crowding the queue',()=>{
 const r=rig();r.c.radio('speaking',0)
 for(let i=1;i<=6;i++)r.c.radio(`real ${i}`,i)
 for(let i=1;i<=9;i++)r.c.radio(`chatter ${i}`,10+i,undefined,{ambient:true})
 const queued=(r.c as unknown as {queue:Array<{message:{text:string;ambient?:boolean}}>}).queue.map(q=>q.message.text)
 expect(queued.filter(t=>t.startsWith('real'))).toEqual(['real 3','real 4','real 5','real 6'])
 expect(queued.filter(t=>t.startsWith('chatter')).length).toBe(6)
 expect(queued.slice(0,4)).toEqual(['real 3','real 4','real 5','real 6'])
})

it('waits a moment between one transmission and the next, and lets stale background chatter lapse later than real traffic',()=>{
 const r=rig();r.c.radio('one',0);r.c.radio('two',100);r.ends[0]!()
 r.c.update(200);expect(r.said).toEqual(['one'])
 r.c.update(400);expect(r.said).toEqual(['one'])
 r.c.update(600);expect(r.said).toEqual(['one','two'])
 const s=rig();s.c.radio('now',0);s.c.radio('bg',1,undefined,{ambient:true});s.c.radio('real',2);s.ends[0]!()
 s.c.update(20_000);s.c.update(21_000);expect(s.said).toEqual(['now','bg'])        // the real one was older than 8 s; the chatter was not older than 25 s
})

it('carries the role, style and spoken words on the message to the voice',()=>{
 const r=rig();r.c.radio('N1, cleared',0,'Palo Alto Tower',{role:'atc',style:'icao',spoken:'November one, cleared'})
 expect(r.messages[0]).toMatchObject({text:'N1, cleared',speaker:'Palo Alto Tower',role:'atc',style:'icao',spoken:'November one, cleared',priority:0})
})

it('lets the player\'s exchange outlive a long wait and go ahead of the other aircraft\'s traffic',()=>{
 const r=rig();r.c.radio('speaking',0)
 r.c.radio('tower to another airplane',10,'Palo Alto Tower',{role:'atc'})
 r.c.radio('reply to me',20,'Palo Alto Tower',{role:'atc',forPlayer:true})
 r.c.radio('background',21,'Skylane 6EK',{role:'pilot',ambient:true})
 const order=(r.c as unknown as {queue:Array<{message:{text:string}}>}).queue.map(q=>q.message.text)
 expect(order).toEqual(['reply to me','tower to another airplane','background'])
 r.ends[0]!();r.c.update(25_000);r.c.update(26_000)
 expect(r.said).toEqual(['speaking','reply to me'])       // 25 s on: the other traffic (8 s) and the chatter... the player's reply (30 s) survived
})

it('keeps the call and the reply in order, and drops other aircraft\'s traffic before the player\'s when the queue is full',()=>{
 const r=rig();r.c.radio('speaking',0)
 r.c.radio('my call',1,'N1',{role:'pilot',forPlayer:true});r.c.radio('their reply',2,'Tower',{role:'atc',forPlayer:true})
 for(let i=1;i<=4;i++)r.c.radio(`other ${i}`,3+i,'Tower',{role:'atc'})
 const queued=(r.c as unknown as {queue:Array<{message:{text:string}}>}).queue.map(q=>q.message.text)
 expect(queued.slice(0,2)).toEqual(['my call','their reply'])
 expect(queued).toHaveLength(4)
 expect(queued).not.toContain('other 1')
})

it('has the driver render a message that has to wait, not one that starts at once',()=>{
 const r=rig();r.c.radio('now',0);r.c.radio('later',1)
 expect(r.prepared).toEqual(['later'])
})
