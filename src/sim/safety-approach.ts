/** Geometric landing corridor, not an airport proximity inhibit. */
export function inRunwayApproach(pos: {lat:number;lon:number}, trackDeg: number, altFt: number, runways: readonly {la1:number;lo1:number;la2:number;lo2:number;e1:number;e2:number;w:number}[]): boolean {
  const scale = 111320, east = scale * Math.cos(pos.lat * Math.PI / 180)
  for (const r of runways) for (const reverse of [false,true]) {
    const lat = reverse ? r.la2 : r.la1, lon = reverse ? r.lo2 : r.lo1
    const dn = ((reverse ? r.la1 : r.la2)-lat)*scale, de=((reverse ? r.lo1:r.lo2)-lon)*east
    const length=Math.hypot(dn,de); if(length<1) continue
    const n=(pos.lat-lat)*scale,e=(pos.lon-lon)*east
    const along=(n*dn+e*de)/length, cross=Math.abs(n*de-e*dn)/length
    const heading=Math.atan2(de,dn)*180/Math.PI
    const delta=Math.abs(((trackDeg-heading+540)%360)-180)
    const height=altFt-(reverse?r.e2:r.e1)
    // Allows flare and runway overflight, but only a narrow incoming cone.
    if(along>=-4*1852 && along<=length && cross<Math.max(r.w*.3048,90)+Math.max(0,-along)*.06 && delta<20 && height>-20 && height<1800) return true
  }
  return false
}
