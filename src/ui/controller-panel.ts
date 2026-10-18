import { mountFlightPanel } from './flight-panel-dock'
import { AXIS_FUNCTIONS, BUTTON_FUNCTIONS, readAxis, readButton, leverWithReverse, calibratedUnipolar, UNIPOLAR, type GamepadMap, type PadReading, type BindableAxis, type BindableButton, type AxisBinding, type ButtonBinding } from '../sim/gamepad-map'
import { ControllerCapture } from '../input/controller-capture'
const LABELS:Partial<Record<BindableAxis|BindableButton,string>>={throttle:'ENG 1 throttle',throttle2:'ENG 2 throttle',reverse:'ENG 1 reverse lift (hold)',reverse2:'ENG 2 reverse lift (hold)',ptt:'Push to talk (hold)',parkingBrake:'Parking brake (latched ON; released = OFF)',engineMaster1:'ENG 1 master (latched ON; released = OFF)',engineMaster2:'ENG 2 master (latched ON; released = OFF)',gearDown:'Gear DOWN position',gearUp:'Gear UP position',speedbrake:'Speedbrake lever',speedbrakeArm:'Speedbrake ARM position'}
const label=(fn:BindableAxis|BindableButton):string=>LABELS[fn]??fn.replace(/([A-Z0-9])/g,' $1')
export class ControllerPanel {
  readonly root=document.createElement('details')
  private readonly status=document.createElement('pre')
  private readonly live=document.createElement('pre')
  private readonly feedback=document.createElement('div')
  private readonly selector=document.createElement('select')
  private readonly endpointRow=document.createElement('div')
  private capture:ControllerCapture|null=null
  private queue:Array<{kind:'axis'|'button';fn:BindableAxis|BindableButton}>=[]
  private latest:readonly(PadReading|null)[]=[]
  private lastRender=0
  private error=''
  get capturing():boolean{return this.capture!==null}
  constructor(private readonly getMap:()=>GamepadMap,private readonly save:(map:GamepadMap)=>void,private readonly onCapture:()=>void) {
    this.root.id='controller-panel';this.root.style.cssText='position:fixed;right:8px;top:54px;z-index:28;width:min(440px,90vw);max-height:75vh;overflow:auto;background:#071923f2;color:#def;padding:10px;border:1px solid #53717e;border-radius:6px;font:12px/1.5 monospace'
    const summary=document.createElement('summary');summary.textContent='Controllers · TCA Captain · J';this.root.append(summary,this.status)
    const help=document.createElement('p');help.textContent='Pause, select a function, then Capture. Move only that control, record endpoints and Save. If you connected after Capture, click Retry.'
    const limits=document.createElement('details'),limitsSummary=document.createElement('summary'),limitsText=document.createElement('p')
    limitsSummary.textContent='Controller and engine model notes'
    limitsText.textContent='Add-on indices require capture. Detent buttons are alternatives to lever axes. Jet masters drive two equal groups in one aggregate thrust/N1 model; opposing directions command idle and engine-out yaw is not modeled. Ignition returns to NORM when mapped CRANK and START are both released.'
    limits.append(limitsSummary,limitsText)

    for(const [kind,fns] of [['axis',AXIS_FUNCTIONS],['button',BUTTON_FUNCTIONS]] as const)for(const fn of fns){const option=document.createElement('option');option.value=`${kind}:${fn}`;option.textContent=`${kind} · ${label(fn)}`;this.selector.append(option)}
    this.selector.setAttribute('aria-label','Controller function');this.selector.style.maxWidth='100%'
    this.status.style.whiteSpace=this.live.style.whiteSpace='pre-wrap'
    const action=(title:string,fn:()=>void):HTMLButtonElement=>{const b=document.createElement('button');b.textContent=title;b.onclick=()=>{fn();b.blur()};return b}
    this.root.append(help,limits,this.selector,action('Capture',()=>{const[k,f]=this.selector.value.split(':');this.start(k as 'axis'|'button',[f as BindableAxis|BindableButton])}),this.feedback)
    for(const [point,title] of [['min','Record minimum / full reverse'],['max','Record maximum / TOGA'],['idle','Record IDLE'],['cl','Record CL (optional)'],['flex','Record FLEX (optional)']] as const)this.endpointRow.append(action(title,()=>{if(!this.capture?.record(point,this.latest))this.feedback.textContent='No finite connected axis reading.'}))
    this.root.append(this.endpointRow,action('Save / Next',()=>this.accept()),action('Retry',()=>{if(this.capture)this.capture=new ControllerCapture(this.capture.kind,this.capture.fn,this.latest)}),action('Skip',()=>this.next()),action('Cancel',()=>{this.capture=null;this.queue=[];this.feedback.textContent='Capture cancelled; saved bindings retained.'}),this.live)
    mountFlightPanel(this.root)
  }
  start(kind:'axis'|'button',functions:readonly(BindableAxis|BindableButton)[]):void {
    this.error='';this.root.open=true;this.queue=functions.map(fn=>({kind,fn}));this.next();this.onCapture()
  }
  toggle():void {this.root.open=!this.root.open}
  private next():void {
    this.error='';const step=this.queue.shift();this.capture=step?new ControllerCapture(step.kind,step.fn,this.latest):null
    this.feedback.textContent=step?'Waiting for deliberate movement…':'Capture finished. Use the function selector to bind any remaining controls.'
  }
  private accept():void {
    const c=this.capture,result=c?.result();if(!c)return
    if(!result){this.error='Record valid minimum and maximum; throttle also requires IDLE. Move in the requested positive direction, Retry if reversed.';return}
    const m=this.getMap()
    if(c.kind==='axis')m[c.fn as BindableAxis]=result as AxisBinding
    else {
      // A captured physical button has one purpose; remove conflicting preset aliases.
      for(const [k,id] of Object.entries(m.devices??{}))if(id===result.deviceId){if(m.btnKeys)delete m.btnKeys[`${k}:${(result as ButtonBinding).btn}`];if(m.unverifiedBtnKeys)delete m.unverifiedBtnKeys[`${k}:${(result as ButtonBinding).btn}`]}
      for(const [fn,b] of Object.entries(m.btn??{}))if(b.deviceId===result.deviceId && b.btn===(result as ButtonBinding).btn)delete m.btn![fn as BindableButton]
      m.btn={...m.btn,[c.fn]:result as ButtonBinding}
    }
    this.save(m);this.next()
  }
  update(pads:readonly(PadReading|null)[],summary:string,now=performance.now()):void {
    this.latest=pads;this.capture?.poll(pads)
    if(now-this.lastRender<100)return;this.lastRender=now
    this.status.textContent=pads.filter(Boolean).map(p=>`${p!.index}: ${p!.id}`).join('\n')||'No controller exposed. Press a device button.'
    if(!this.root.open)return
    const m=this.getMap(),lines=[summary]
    if(Object.keys(m.unverifiedBtnKeys??{}).length)lines.push('Saved buttons awaiting capture: '+Object.entries(m.unverifiedBtnKeys!).map(([key,code])=>`${key} ${code}`).join(', '))
    for(const fn of ['throttle','throttle2'] as const){const r=readAxis(m,fn,pads),b=m[fn],v=r===null?null:leverWithReverse(r,b?.calibration);let detent=v?.reverse?'REV':v && v.power<.02?'IDLE':v && v.power>.98?'TOGA':'travel';for(const d of ['cl','flex'] as const)if(r!==null && b?.calibration?.[d]!==undefined && Math.abs(r-b.calibration[d]!)<.035)detent=d.toUpperCase();lines.push(`${label(fn)}: ${v?`${Math.round(v.power*100)}% ${detent} raw ${r!.toFixed(3)}`:'unavailable'}`)}
    for(const fn of AXIS_FUNCTIONS){if(fn==='throttle'||fn==='throttle2')continue;const r=readAxis(m,fn,pads);lines.push(`${label(fn)}: ${r===null?'unbound / unavailable':UNIPOLAR.has(fn)?`${Math.round(calibratedUnipolar(r,m[fn])*100)}%`:r.toFixed(3)}`)}
    for(const fn of BUTTON_FUNCTIONS)lines.push(`${label(fn)}: ${readButton(m,fn,pads)===null?'unbound / unavailable':readButton(m,fn,pads)?'ON':'OFF'}`)
    if(this.capture){const c=this.capture,axis=c.kind==='axis',throttle=c.fn==='throttle'||c.fn==='throttle2';this.feedback.textContent=`${this.error?this.error+' · ':''}Capture ${label(c.fn)} · ${this.queue.length+1} remaining. ${c.message}\n${axis?'Start at minimum, move toward '+(throttle?'TOGA':'maximum / right / pull nose up')+'. ': 'Release first, then press or select the target position. '}${c.candidate?JSON.stringify(c.candidate):''}\nraw: ${c.raw(pads)?.toFixed(3)??'—'} points: ${JSON.stringify(c.points)}`;this.endpointRow.hidden=!axis || !UNIPOLAR.has(c.fn as BindableAxis)}else this.endpointRow.hidden=true
    lines.push('RAW LIVE (verify movement before saving)')
    for(const p of pads)if(p)lines.push(`pad ${p.index} axes ${p.axes.map((a,i)=>`${i}:${a.toFixed(2)}`).join(' ')}\nbuttons down: ${p.buttons.flatMap((b,i)=>b.pressed?[i]:[]).join(', ')}`)
    this.live.textContent=lines.join('\n')
  }
}
