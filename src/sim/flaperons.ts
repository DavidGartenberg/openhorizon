import type { AircraftParams } from './aircraft/params'
export function flapIndex(p: AircraftParams, index: number): number {
 return Number.isFinite(index) ? Math.max(0,Math.min(p.flapDetentsDeg.length-1,Math.round(index))) : (p.flapDefaultIndex ?? 0)
}
/** MM endpoint is handle 10 mm beyond +5; linear -9..+5 floor and held
 * displacement are explicit approximations pending a measured lever map. */
export function airbrakeFlapFloor(p: AircraftParams, position: number): number {
 const f=p.flaperons
 return f ? f.airbrakeFloorMinDeg+(f.airbrakeFloorMaxDeg-f.airbrakeFloorMinDeg)*Math.max(0,Math.min(1,Number.isFinite(position)?position:0)) : 0
}
/** Neutral-flap MM roll differential, extrapolated at other flap settings.
 * No invented combined stops: pure flap endpoints are not roll limits. */
export function mixFlaperons(p: AircraftParams, baseDeg: number, roll: number, out: {flapsDeg:number;aileronRad:number;flaperonLeftRad:number;flaperonRightRad:number}): void {
 const f=p.flaperons!
 const r=Math.max(-1,Math.min(1,Number.isFinite(roll)?roll:0)), base=baseDeg*Math.PI/180
 out.flaperonLeftRad=base+(r>=0?r*f.downRad:r*f.upRad)
 out.flaperonRightRad=base+(r>=0?-r*f.upRad:-r*f.downRad)
 out.flapsDeg=(out.flaperonLeftRad+out.flaperonRightRad)*90/Math.PI
 out.aileronRad=(out.flaperonLeftRad-out.flaperonRightRad)/2
}
