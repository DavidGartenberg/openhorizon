import {afterEach,expect,it,vi} from 'vitest'
import {bindPushToTalk} from '../src/voice/bindings'
import {PushToTalk} from '../src/voice/ptt'
import {captureMicrophone} from '../src/voice/recorder'
class Element extends EventTarget {editable=false;closest(){return this.editable?this:null}setPointerCapture=vi.fn()}
function emit(target:EventTarget,type:string,fields:Record<string,unknown>={}){const e=new Event(type,{cancelable:true});Object.assign(e,fields);target.dispatchEvent(e)}
afterEach(()=>vi.unstubAllGlobals())
it('key repeats, outside release, blur, input focus and teardown cannot leave a hold',()=>{
 vi.stubGlobal('HTMLElement',Element)
 const host=new EventTarget() as Window;Object.assign(host,{document:new EventTarget()})
 const button=new Element(),hold=vi.fn(),reset=vi.fn();const unbind=bindPushToTalk({hold,reset} as unknown as PushToTalk,button as unknown as HTMLElement,host,()=>true)
 emit(host,'keydown',{code:'KeyT',repeat:false});emit(host,'keydown',{code:'KeyT',repeat:true});emit(host,'keyup',{code:'KeyT'})
 expect(hold.mock.calls).toEqual([['key',true],['key',false]])
 emit(button,'pointerdown',{button:0,pointerId:4});emit(host,'pointerup',{pointerId:4});expect(hold.mock.calls.slice(-2)).toEqual([['pointer',true],['pointer',false]])
 emit(host,'blur');emit(host,'gamepaddisconnected');emit(host,'pointercancel')
 const editable=new Element();editable.editable=true
 const focus=new Event('focusin');Object.defineProperty(focus,'target',{value:editable});host.dispatchEvent(focus)
 Object.assign(host.document,{hidden:true});emit(host.document,'visibilitychange')
 expect(reset).toHaveBeenCalledTimes(5)
 unbind();emit(host,'keydown',{code:'KeyT'});expect(hold).toHaveBeenCalledTimes(4)
})
it('does not request microphone after cancellation during audio-context resume',async()=>{
 let resume!:()=>void;const close=vi.fn(async()=>{}),getUserMedia=vi.fn();
 vi.stubGlobal('AudioContext',class {resume(){return new Promise<void>(ok=>resume=ok)}close=close})
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}})
 const abort=new AbortController();const pending=captureMicrophone(abort.signal);abort.abort();resume()
 await expect(pending).rejects.toThrow(/cancel/i);expect(getUserMedia).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce()
})
it('stops a late microphone stream after permission was cancelled',async()=>{
 let resolve!:(stream:any)=>void;const stop=vi.fn()
 vi.stubGlobal('AudioContext',class {resume(){return Promise.resolve()}close(){return Promise.resolve()}})
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(ok=>resolve=ok)}})
 const abort=new AbortController();const pending=captureMicrophone(abort.signal);await Promise.resolve();abort.abort();resolve({getTracks:()=>[{stop}]})
 await expect(pending).rejects.toThrow(/cancel/i);expect(stop).toHaveBeenCalledOnce()
})
