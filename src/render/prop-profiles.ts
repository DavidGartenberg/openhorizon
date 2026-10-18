/** Visual proportions estimated from manufacturer three-views/photos; only overall
 * length/span/area and prop diameter come from the audited flight-data roster.
 * Primary references (family arrangement, not a claim of CAD measurements):
 * https://www.pilatus-aircraft.com/assets/files/Model-Building-Plans/PC-12-NGX-Model-Building-Plan.pdf
 * https://dehavilland.com/twin-otter/
 * https://beechcraft.txtav.com/-/media/beechcraft/files/brochures/txtav_beechcraft_pistons_brochure.pdf
 * https://beechcraft.txtav.com/KINGAIR
 * https://www.piaggioaerospace.it/yep-content/media/P180-AvantiEVO-brochure.pdf
 * https://www.antonov.com/history/an-2
 * Dimensions below describe the visual envelope, not certified engineering data.
 */
export interface PropProfile {
  family: string; width: number; height: number; wing: 'high'|'mid'|'low'; tail: 'normal'|'t'|'v'
  taper: number; struts: boolean; windows: number; blades: number
  canopy?: boolean; biplane?: boolean; pusher?: boolean; tipTanks?: boolean
  radial?: boolean; glider?: boolean; military?: boolean; mooney?: boolean
  winglets?: boolean; color?: number; fin?: number
  rollControl?: 'aileron'|'spoiler'|'flaperon'; flapSystem?: 'plain'|'fowler'|'none'; airbrakes?: boolean; airbrakeTiers?: 1|2
  biplaneControls?: 'an2-upper-aileron-upper-lower-flaps'
}
const p = (family:string,width:number,height:number,wing:PropProfile['wing'],tail:PropProfile['tail']='normal', extra:Partial<PropProfile>={}):PropProfile =>
  ({family,width,height,wing,tail,taper:.52,struts:false,windows:2,blades:3,...extra})
const high = p('Cessna utility',1.18,1.42,'high','normal',{struts:true,taper:.70})
const low = p('Piper cabin single',1.12,1.28,'low','normal',{taper:.70})
const beech = p('Beech cabin',1.16,1.36,'low','normal',{taper:.43,windows:3})
const diamond = p('Diamond composite',1.14,1.22,'low','t',{canopy:true,taper:.36})
const bush = p('Fabric bush',.80,1.35,'high','normal',{struts:true,taper:.88,windows:2,blades:2,color:0xf4c72b})
const commuter = p('Regional turboprop',2.65,2.72,'high','t',{windows:12,blades:6,taper:.38})
const king = p('King Air',1.60,1.77,'low','t',{windows:5,blades:4,taper:.38})
const sailplane = p('Sailplane',.66,.79,'mid','t',{canopy:true,glider:true,taper:.20,windows:0,blades:0,fin:.13})
/** Deliberately exhaustive: an unprofiled new roster type must fail visibly. */
export const PROP_PROFILES: Record<string,PropProfile> = {
 P28A:low,P28B:{...low,family:'Dakota'},P28R:{...low,family:'Arrow'},PA32:{...low,width:1.23,windows:3},
 SR22:p('Cirrus',1.27,1.42,'low','normal',{canopy:false,taper:.40}),SR20:p('Cirrus',1.27,1.42,'low','normal',{canopy:false,taper:.40}),
 C182:high,C152:{...high,width:1.02,height:1.22,blades:2},C150:{...high,width:1.02,height:1.22,blades:2},
 C206:{...high,width:1.25,windows:3},C207:{...high,width:1.25,windows:4},C210:{...high,struts:false,windows:3},
 C177:{...high,struts:false,taper:.54,family:'Cardinal'},
 PA18:bush,DHC2:p('Beaver radial',1.50,1.78,'high','normal',{radial:true,struts:true,taper:.92,windows:3}),
 BE36:beech,BE33:beech,BE35:{...beech,tail:'v'},BE58:{...beech,family:'Baron'},BE55:{...beech,family:'Baron',windows:2},
 M20P:p('Mooney',1.07,1.19,'low','normal',{mooney:true,taper:.52}),
 DA40:diamond,DA42:{...diamond,family:'Diamond twin'},
 PA44:{...low,tail:'t',family:'Seminole'},PA34:{...low,windows:3,family:'Seneca'},
 C310:p('Cessna twin',1.19,1.40,'low','normal',{tipTanks:true,taper:.43,windows:3}),
 P51:p('Mustang',1.04,1.30,'low','normal',{canopy:true,military:true,taper:.43,blades:4,color:0xc1c5c6}),
 E300:p('Extra aerobatic',.77,.95,'mid','normal',{canopy:true,taper:.47,color:0xb82028}),
 TBM9:p('TBM',1.44,1.55,'low','normal',{windows:3,taper:.45,blades:5}),
 TBM7:p('TBM',1.44,1.55,'low','normal',{windows:3,taper:.45,blades:4}),
 PC12:p('Pilatus single',1.65,1.84,'low','t',{windows:6,taper:.46,blades:5,winglets:true}),
 C208:p('Caravan',1.63,1.93,'high','normal',{struts:true,windows:6,taper:.78}),
 KODI:p('Kodiak',1.46,1.80,'high','normal',{struts:true,windows:4,taper:.70,blades:4}),
 B350:{...king,winglets:true},BE20:king,BE9L:{...king,tail:'normal',windows:4},
 B190:{...king,width:1.64,height:1.89,windows:9},
 DHC6:p('Twin Otter',1.78,2.0,'high','normal',{struts:true,windows:8,taper:.76}),
 AT76:commuter,AT45:{...commuter,windows:9},DH8D:{...commuter,width:2.70,height:2.85,windows:17},DH8A:{...commuter,width:2.70,height:2.85,windows:10,blades:4},
 SF34:p('Saab 340',2.10,2.20,'low','normal',{windows:10,taper:.44,blades:4}),
 E120:p('Brasilia',2.25,2.35,'low','t',{windows:10,taper:.40,blades:4}),
 D328:{...commuter,family:'Dornier regional',width:2.35,height:2.60,windows:10},
 JS41:p('Jetstream',1.92,2.08,'low','normal',{windows:10,taper:.48,blades:5}),
 SW4:p('Metro',1.63,1.75,'low','normal',{windows:13,taper:.57,blades:4}),
 D228:p('Dornier utility',1.73,1.91,'high','normal',{windows:9,taper:.34,blades:5}),
 L410:p('Let utility',1.91,2.02,'high','t',{windows:8,taper:.66,blades:5,tipTanks:true}),
 MU2:p('Mitsubishi',1.57,1.73,'high','normal',{windows:5,taper:.55,tipTanks:true,blades:4,rollControl:'spoiler',flapSystem:'fowler'}),
 P180:p('Avanti three-surface',1.85,1.94,'mid','t',{windows:6,pusher:true,taper:.42,blades:5}),
 C130:p('Hercules',3.90,4.10,'high','normal',{windows:0,military:true,taper:.42,blades:4,color:0x788078}),
 AN2:p('Antonov biplane',1.93,2.40,'high','normal',{radial:true,biplane:true,taper:.91,windows:5,blades:4,color:0xb8bd91,biplaneControls:'an2-upper-aileron-upper-lower-flaps'}),
 AS21:{...sailplane,width:.78,height:.92,taper:.34,flapSystem:'none',airbrakes:true},DG80:{...sailplane,rollControl:'flaperon',flapSystem:'none',airbrakes:true,airbrakeTiers:2},LS8:{...sailplane,winglets:true,flapSystem:'none',airbrakes:true,airbrakeTiers:2},DISC:{...sailplane,winglets:true,flapSystem:'none',airbrakes:true},
}
