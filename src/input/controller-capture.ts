import { detectMovedAxis, detectPressedButton, validCalibration, UNIPOLAR, type AxisBinding, type AxisCalibration, type BindableAxis, type BindableButton, type ButtonBinding, type PadReading } from '../sim/gamepad-map'
export class ControllerCapture {
  candidate: AxisBinding | ButtonBinding | null = null
  points: Partial<AxisCalibration> = {}
  message = 'Move only the requested control. New devices cannot participate; Retry after connecting.'
  private readonly baseline: readonly (PadReading|null)[]
  constructor(readonly kind:'axis'|'button', readonly fn:BindableAxis|BindableButton,pads:readonly(PadReading|null)[]) {
    this.baseline=pads.map(p=>p?{id:p.id,index:p.index,connected:p.connected,axes:[...p.axes],buttons:p.buttons.map(b=>({pressed:b.pressed}))}:null)
  }
  poll(pads:readonly(PadReading|null)[]):void {
    if(this.candidate)return
    const beforeAxes:number[][]=[],afterAxes:number[][]=[],beforeButtons:boolean[][]=[],afterButtons:boolean[][]=[]
    for(const old of this.baseline){
      if(!old)continue
      const p=pads.find(p=>p && p.index===old.index && p.id===old.id && p.connected!==false)
      if(!p)continue
      beforeAxes[p.index]=[...old.axes];afterAxes[p.index]=[...p.axes]
      for(let i=0;i<old.buttons.length;i++)if(p.buttons[i]?.pressed===false)old.buttons[i]!.pressed=false
      beforeButtons[p.index]=old.buttons.map(b=>b.pressed);afterButtons[p.index]=p.buttons.map(b=>b.pressed)
    }
    const hit=this.kind==='axis'?detectMovedAxis(beforeAxes,afterAxes,.45):detectPressedButton(beforeButtons,afterButtons)
    if(hit){this.candidate={...hit,source:'user',deviceId:pads.find(p=>p?.index===hit.pad)!.id};this.message=this.kind==='axis'?'Movement found. Verify live raw value and record the endpoints, then Save.':'Press found. Verify this control, then Save.'}
  }
  raw(pads:readonly(PadReading|null)[]):number|null {
    const c=this.candidate;if(!c || !('axis' in c))return null
    const matches=pads.filter(p=>p && p.id===c.deviceId && p.connected!==false)
    const v=matches.length===1?matches[0]?.axes[c.axis]:undefined
    return typeof v==='number' && Number.isFinite(v)?v*c.sign:null
  }
  record(point:keyof AxisCalibration,pads:readonly(PadReading|null)[]):boolean {
    const raw=this.raw(pads);if(raw===null)return false
    this.points[point]=raw;return true
  }
  result():AxisBinding|ButtonBinding|null {
    if(!this.candidate)return null
    if(this.kind==='button')return this.candidate
    const axis=this.fn as BindableAxis
    if(!UNIPOLAR.has(axis))return this.candidate
    if(!validCalibration(this.points) || ((axis==='throttle'||axis==='throttle2') && this.points.idle===undefined))return null
    return {...this.candidate,calibration:{...this.points} as AxisCalibration}
  }
}
