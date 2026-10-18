import type {PushToTalk} from './ptt'
/** All listener ownership is explicit for teardown and simulator reinitialization. */
export function bindPushToTalk(ptt:PushToTalk,button:HTMLElement,host:Window,enabled:()=>boolean):()=>void {
  let pointer:number|undefined
  const keydown=(e:KeyboardEvent)=>{if(e.code==='KeyT'&&!e.repeat&&enabled()&&!(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable="true"]'))){e.preventDefault();ptt.hold('key',true)}}
  const keyup=(e:KeyboardEvent)=>{if(e.code==='KeyT')ptt.hold('key',false)}
  const down=(e:PointerEvent)=>{if(e.button!==0||!enabled())return;e.preventDefault();pointer=e.pointerId;button.setPointerCapture?.(e.pointerId);ptt.hold('pointer',true)}
  const up=(e:PointerEvent)=>{if(e.pointerId===pointer){pointer=undefined;ptt.hold('pointer',false)}}
  const cancel=()=>{pointer=undefined;ptt.reset()}
  const focus=(e:FocusEvent)=>{if(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable="true"]'))cancel()}
  const hidden=()=>{if(host.document.hidden)cancel()}
  host.addEventListener('keydown',keydown);host.addEventListener('keyup',keyup);host.addEventListener('pointerup',up);host.addEventListener('pointercancel',cancel);host.addEventListener('blur',cancel);host.addEventListener('gamepaddisconnected',cancel);host.addEventListener('focusin',focus);host.document.addEventListener('visibilitychange',hidden);button.addEventListener('pointerdown',down)
  return ()=>{cancel();host.removeEventListener('keydown',keydown);host.removeEventListener('keyup',keyup);host.removeEventListener('pointerup',up);host.removeEventListener('pointercancel',cancel);host.removeEventListener('blur',cancel);host.removeEventListener('gamepaddisconnected',cancel);host.removeEventListener('focusin',focus);host.document.removeEventListener('visibilitychange',hidden);button.removeEventListener('pointerdown',down)}
}
