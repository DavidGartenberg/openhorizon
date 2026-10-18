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
