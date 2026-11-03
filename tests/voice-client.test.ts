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

const tick=()=>new Promise(r=>setTimeout(r,5))

it('renders one clip at a time, speech that is due now ahead of rendering done in advance',async()=>{
  const order:string[]=[];const gates:Array<()=>void>=[]
  vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{order.push(JSON.parse(options.body).text);await new Promise<void>(r=>gates.push(r));return new Response(new Blob([new Uint8Array(64)]))}))
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:x');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  const client=new LocalVoiceClient();client.status.synthesis=true
  const signal=new AbortController().signal
  const m=(text:string)=>({text,priority:0,speaker:'N1',role:'pilot' as const})
  void client.prewarm([m('warm one')],signal);void client.prewarm([m('warm two')],signal)
  const live=client.resolveSpeech(m('live now'),signal)
  await tick();expect(order).toEqual(['warm one'])                    // one at a time
  gates[0]!();await tick();expect(order).toEqual(['warm one','live now'])   // the live one jumped the queue
  gates[1]!();await live;await tick()
  expect(order).toEqual(['warm one','live now','warm two']);gates[2]!()
})

it('waits out a busy synthesizer for as long as a transmission is worth, not four tries',async()=>{
  let calls=0
  vi.useFakeTimers()
  try{
    vi.stubGlobal('fetch',vi.fn(async()=>++calls<=6?new Response('{"error":"busy"}',{status:429}):new Response(new Blob([new Uint8Array(64)]))))
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:x')
    const client=new LocalVoiceClient();client.status.synthesis=true
    const speech=client.resolveSpeech({text:'Tower reply',priority:0},new AbortController().signal)
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await speech)?.url).toBe('blob:x');expect(calls).toBe(7)
  }finally{vi.useRealTimers()}
})

it('skips rendering ahead of a clip that was rendered meanwhile, and lets a cancelled wait go without holding the synthesizer',async()=>{
  let calls=0;const gates:Array<()=>void>=[]
  vi.stubGlobal('fetch',vi.fn(async()=>{calls++;await new Promise<void>(r=>gates.push(r));return new Response(new Blob([new Uint8Array(64)]))}))
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:x');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  const client=new LocalVoiceClient();client.status.synthesis=true
  const message={text:'same phrase',priority:0,speaker:'N2',role:'atc' as const}
  const first=client.resolveSpeech(message,new AbortController().signal)           // renders now
  void client.prewarm([message],new AbortController().signal)                       // queued for the same phrase
  const gone=new AbortController();const waiting=client.resolveSpeech({text:'never needed',priority:0},gone.signal)
  gone.abort();await expect(waiting).rejects.toThrow()
  await tick();gates[0]!();await first;await tick()
  expect(calls).toBe(1)                                                              // the queued copy found the clip already there
})
