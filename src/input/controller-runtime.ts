import { BUTTON_FUNCTIONS, readButton, readAlias, type GamepadMap, type BindableButton, type PadReading } from '../sim/gamepad-map'
/** Release-before-rearm for momentary controls; latched switches are read
 * separately as absolute states. Unknown/disconnected is never a release. */
export class ControllerRuntime {
  private armed=new Set<string>()
  private previous=new Map<string,boolean>()
  private signature=''
  reset():void {this.armed.clear();this.previous.clear();this.signature=''}
  poll(map:GamepadMap,pads:readonly(PadReading|null)[],eligible:boolean):{held:(fn:BindableButton)=>boolean;pressed:(fn:BindableButton)=>boolean;aliases:Map<string,{held:boolean;pressed:boolean}>} {
    const signature=JSON.stringify([pads.filter(Boolean).map(p=>[p!.id,p!.index,p!.axes.length,p!.buttons.length]),map])
    if(signature!==this.signature || !eligible){this.armed.clear();this.previous.clear();this.signature=signature}
    const values=new Map<string,{held:boolean;pressed:boolean}>()
    const sample=(key:string,physical:boolean|null):void=>{
      if(!eligible || physical===null){this.armed.delete(key);this.previous.delete(key);values.set(key,{held:false,pressed:false});return}
      if(!physical)this.armed.add(key)
      const held=physical && this.armed.has(key)
      values.set(key,{held,pressed:held && !this.previous.get(key)});this.previous.set(key,held)
    }
    for(const fn of BUTTON_FUNCTIONS)sample(fn,readButton(map,fn,pads))
    const aliases=new Map<string,{held:boolean;pressed:boolean}>()
    for(const key of Object.keys(map.btnKeys??{})){sample(`key:${key}`,readAlias(map,key,pads));aliases.set(key,values.get(`key:${key}`)!)}
    return {held:fn=>values.get(fn)?.held??false,pressed:fn=>values.get(fn)?.pressed??false,aliases}
  }
}
