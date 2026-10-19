import {it,expect,vi,afterEach} from 'vitest'
import {mountFlightPanel} from '../src/ui/flight-panel-dock'
class Node {
 id='';style:Record<string,string>={};children:Node[]=[];parentElement:Node|null=null
 appendChild(child:Node){child.parentElement=this;this.children.push(child);return child}
 setAttribute(_key:string,_value:string){}
}
afterEach(()=>vi.unstubAllGlobals())
it('mounts both panels in the same responsive scrolling stack rather than overlapping fixed rectangles',()=>{
 const body=new Node()
 vi.stubGlobal('document',{body,createElement:()=>new Node(),getElementById:(id:string)=>body.children.find(n=>n.id===id)??null})
 const controller=new Node(),loading=new Node()
 mountFlightPanel(controller as unknown as HTMLElement)
 mountFlightPanel(loading as unknown as HTMLElement)
 const dock=body.children[0]!
 expect(body.children).toHaveLength(1)
 expect(controller.parentElement).toBe(dock);expect(loading.parentElement).toBe(dock)
 expect(dock.style.display).toBe('flex');expect(dock.style.flexDirection).toBe('column')
 expect(dock.style.overflowY).toBe('auto')
 expect(dock.style.width).toContain('100vw - 16px')
 expect(controller.style.position).toBe('relative');expect(loading.style.position).toBe('relative')
 expect(controller.style.flex).toBe('0 0 auto');expect(loading.style.flex).toBe('0 0 auto')
 expect(controller.style.width).toBe('100%');expect(loading.style.width).toBe('100%')
})
