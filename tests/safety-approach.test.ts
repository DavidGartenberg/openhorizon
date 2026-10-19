import {expect,it} from 'vitest'
import {inRunwayApproach} from '../src/sim/safety-approach'
const runway={la1:0,lo1:0,la2:.02,lo2:0,e1:0,e2:0,w:150}
it('requires incoming alignment and corridor, not airport distance',()=>{
 expect(inRunwayApproach({lat:-.03,lon:0},0,600,[runway])).toBe(true)
 expect(inRunwayApproach({lat:-.03,lon:0},180,600,[runway])).toBe(false)
 expect(inRunwayApproach({lat:-.03,lon:.02},0,600,[runway])).toBe(false)
 expect(inRunwayApproach({lat:.04,lon:0},180,500,[runway])).toBe(true)
})
