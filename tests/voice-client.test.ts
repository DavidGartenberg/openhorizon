import {afterEach,expect,it,vi} from 'vitest'
import {LocalVoiceClient} from '../src/voice/client'
afterEach(()=>vi.unstubAllGlobals())
it('uses only same-origin local endpoints and preserves the caller cancellation signal',async()=>{
 const requests:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(url.endsWith('status')?{transcription:true,synthesis:true,engine:'whisper.cpp',maxSeconds:20}:{text:'ready for departure'}),{headers:{'Content-Type':'application/json'}})}))
 const client=new LocalVoiceClient();expect((await client.refresh()).transcription).toBe(true)
 const signal=new AbortController().signal;expect(await client.transcribe(new Blob(['pcm']),signal)).toBe('ready for departure')
 expect(requests.map(r=>r.url)).toEqual(['/api/voice/status','/api/voice/transcribe']);expect(requests[1].options.signal).toBe(signal);expect(requests[1].options.headers['Content-Type']).toBe('audio/wav')
})
it('exposes service errors and revokes dynamic audio on release',async()=>{
 const client=new LocalVoiceClient();vi.stubGlobal('fetch',async()=>new Response('{"error":"Microphone audio too short"}',{status:400}));await expect(client.transcribe(new Blob(),new AbortController().signal)).rejects.toThrow('Microphone audio too short')
 client.status.synthesis=true
 const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:voice')
 vi.stubGlobal('fetch',async()=>new Response(new Uint8Array(100),{headers:{'Content-Type':'audio/wav'}}))
 const speech=await client.resolveSpeech({text:'Tower reply',priority:0},new AbortController().signal);expect(speech?.url).toBe('blob:voice');speech?.release();expect(revoke).toHaveBeenCalledWith('blob:voice');create.mockRestore();revoke.mockRestore()
})
it('does not make a synthesis request when the local engine is absent',async()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);expect(await new LocalVoiceClient().resolveSpeech({text:'test',priority:0},new AbortController().signal)).toBeUndefined();expect(fetcher).not.toHaveBeenCalled()})

it('sends the spoken phraseology to the synthesizer, not the written text',async()=>{
  const sent:any[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:any)=>{
    if(url.endsWith('status'))return new Response(JSON.stringify({transcription:true,synthesis:true,engine:'whisper.cpp',maxSeconds:20}),{headers:{'Content-Type':'application/json'}})
    sent.push(JSON.parse(options.body));return new Response(new Blob([new Uint8Array(64)]),{headers:{'Content-Type':'audio/wav'}})
  }))
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:x'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  const client=new LocalVoiceClient();await client.refresh()
  const speech=await client.resolveSpeech({text:'N172SP, runway 28L, contact tower 118.70',priority:0},new AbortController().signal)
  expect(sent[0].text).toBe('November one seven two Sierra Papa, runway two eight left, contact tower one one eight point seven')
  speech?.release();create.mockRestore();revoke.mockRestore()
})

it('caches synthesized clips: a repeated phrase does not hit the synthesizer again, and each play gets its own URL',async()=>{
  let speakCalls=0
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url.endsWith('speak'))speakCalls++
    return new Response(new Blob([new Uint8Array(64)]),{headers:{'Content-Type':'audio/wav'}})
  }))
  let n=0
  const create=vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:${++n}`),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  const client=new LocalVoiceClient();client.status.synthesis=true
  const a=await client.resolveSpeech({text:'rotate',priority:1,speaker:'first-officer'},new AbortController().signal)
  const b=await client.resolveSpeech({text:'rotate',priority:1,speaker:'first-officer'},new AbortController().signal)
  expect(speakCalls).toBe(1)
  expect(a?.url).not.toBe(b?.url)
  // a different speaker is a different voice, so it is a different clip
  await client.resolveSpeech({text:'rotate',priority:0,speaker:'tower'},new AbortController().signal)
  expect(speakCalls).toBe(2)
  create.mockRestore();revoke.mockRestore()
})
it('prewarm renders the listed phrases once, skips cached ones and tolerates failures',async()=>{
  const spoken:string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{
    const text=JSON.parse(options.body).text
    if(text==='bad')return new Response('{"error":"nope"}',{status:502})
    spoken.push(text);return new Response(new Blob([new Uint8Array(64)]),{headers:{'Content-Type':'audio/wav'}})
  }))
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:w'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  const client=new LocalVoiceClient();client.status.synthesis=true
  const msgs=['rotate','bad','vee one','rotate'].map(text=>({text,priority:1,speaker:'first-officer'}))
  await client.prewarm(msgs,new AbortController().signal)
  expect(spoken).toEqual(['rotate','vee one'])
  const calls=(fetch as any).mock.calls.length
  const speech=await client.resolveSpeech({text:'vee one',priority:1,speaker:'first-officer'},new AbortController().signal)
  expect(speech?.url).toBe('blob:w');expect((fetch as any).mock.calls.length).toBe(calls) // served from the warmed clip
  create.mockRestore();revoke.mockRestore()
})
it('retries once the synthesizer reports busy instead of dropping the phrase',async()=>{
  let calls=0
  vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return calls<2?new Response('{"error":"busy"}',{status:429}):new Response(new Blob([new Uint8Array(64)]),{headers:{'Content-Type':'audio/wav'}})}))
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:r'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  const client=new LocalVoiceClient();client.status.synthesis=true
  const speech=await client.resolveSpeech({text:'cleared to land',priority:0},new AbortController().signal)
  expect(speech?.url).toBe('blob:r');expect(calls).toBe(2)
  create.mockRestore();revoke.mockRestore()
})
