/**
 * X-Plane 12 exterior-model manifest (auto-extracted from the user's local
 * install by the obj8 workflow, 2026-08-13). relPaths are requested verbatim
 * from /xp/aircraft/<relPath>; nothing is copied into the repo.
 */
export interface XpModelEntry { folder: string; objs: string[]; liveries: string[] }
export const XP_MODELS: Record<string, XpModelEntry> = {
  "C172": { folder: "Cessna 172 SP", objs: ["Cessna 172 SP/objects/fuselage.obj", "Cessna 172 SP/objects/fuselage_gear.obj", "Cessna 172 SP/objects/fuselage_prop.obj", "Cessna 172 SP/objects/wings.obj", "Cessna 172 SP/objects/glass_out.obj", "Cessna 172 SP/objects/cockpit_1.obj", "Cessna 172 SP/objects/cockpit_2.obj", "Cessna 172 SP/objects/cockpit_seats_front.obj", "Cessna 172 SP/objects/cockpit_seats_rear.obj"], liveries: ["full_white", "old_style", "scratches", "waves", "xplane10"] },
  "B738": { folder: "Boeing 737-800", objs: ["Boeing 737-800/objects/738fuselage.obj", "Boeing 737-800/objects/738wings.obj", "Boeing 737-800/objects/738tailwinglets.obj", "Boeing 737-800/objects/738cfm56L.obj", "Boeing 737-800/objects/738cfm56R.obj", "Boeing 737-800/objects/738maingear.obj", "Boeing 737-800/objects/738nosegear.obj", "Boeing 737-800/objects/738alpha.obj", "Boeing 737-800/objects/738_cockpit_glass.obj"], liveries: ["Aerolineas Argentinas", "Air China", "Alaska", "China Eastern", "Delta", "KLM", "Qantas", "Ryanair", "Southwest", "Thai Lion", "Xiamen"] },
  "A333": { folder: "Airbus A330-300", objs: ["Airbus A330-300/objects/A330_fuselage_A.obj", "Airbus A330-300/objects/A330_fuselage_B.obj", "Airbus A330-300/objects/A330_fuselage_C.obj", "Airbus A330-300/objects/A330_wings.obj", "Airbus A330-300/objects/A330_tail_gearbay.obj", "Airbus A330-300/objects/A330_trent_700.obj", "Airbus A330-300/objects/A330_main_gear.obj", "Airbus A330-300/objects/A330_nose_gear.obj", "Airbus A330-300/objects/A330_exterior_glass.obj", "Airbus A330-300/objects/A330_pax_windows.obj"], liveries: ["AirAsia", "AirCanada", "CathayPacific", "Laminar House", "Lufthansa D-AIKI", "SwissAir", "VirginAtlantic"] },
  "MD82": { folder: "McDonnell Douglas MD-82", objs: ["McDonnell Douglas MD-82/objects/Fuselage_1.obj", "McDonnell Douglas MD-82/objects/Fuselage_2.obj", "McDonnell Douglas MD-82/objects/wings.obj", "McDonnell Douglas MD-82/objects/Hor_stab.obj", "McDonnell Douglas MD-82/objects/Vert_stab.obj", "McDonnell Douglas MD-82/objects/Engines.obj", "McDonnell Douglas MD-82/objects/gear_main.obj", "McDonnell Douglas MD-82/objects/gear_nose.obj", "McDonnell Douglas MD-82/objects/Gear_doors.obj", "McDonnell Douglas MD-82/objects/Details.obj", "McDonnell Douglas MD-82/objects/blend.obj"], liveries: ["Aeromexico", "Alaska Airlines", "Alitalia", "Delta Airlines", "Iberia", "JAL", "Scandinavian Airlines", "White"] },
  "SR22": { folder: "Cirrus SR22", objs: ["Cirrus SR22/objects/SR22_exterior.obj", "Cirrus SR22/objects/SR22_glass.obj"], liveries: ["Carbon CorsoWhite", "Carbon FrostWhite", "Carbon ZanzibarWhite", "Platinum BajaWhite", "Rhodium Sterling"] },
  "BE58": { folder: "Beechcraft Baron 58", objs: ["Beechcraft Baron 58/objects/B58_fuselage.obj", "Beechcraft Baron 58/objects/B58_wings.obj", "Beechcraft Baron 58/objects/B58_J3YF_propellers.obj", "Beechcraft Baron 58/objects/B58_Glass_out.obj", "Beechcraft Baron 58/objects/B58_lights.obj"], liveries: ["Classic", "White"] },
  "PA18": { folder: "Piper PA-18 Super Cub", objs: ["Piper PA-18 Super Cub/objects/fuselage.obj", "Piper PA-18 Super Cub/objects/wing.obj", "Piper PA-18 Super Cub/objects/prop.obj", "Piper PA-18 Super Cub/objects/glass_out.obj"], liveries: ["Redbull", "blue", "red", "white"] },
  "AS21": { folder: "Schleicher ASK 21", objs: ["Schleicher ASK 21/objects/fuse.obj", "Schleicher ASK 21/objects/wing_L.obj", "Schleicher ASK 21/objects/wing_R.obj", "Schleicher ASK 21/objects/tail_oriz.obj", "Schleicher ASK 21/objects/glass.obj"], liveries: ["orange", "white"] },
  "C750": { folder: "Cessna Citation X", objs: ["Cessna Citation X/objects/fuselage_wing/fuselage.obj", "Cessna Citation X/objects/fuselage_wing/wing_L.obj", "Cessna Citation X/objects/fuselage_wing/wing_R.obj", "Cessna Citation X/objects/engine/engine.obj", "Cessna Citation X/objects/gear/gear.obj", "Cessna Citation X/objects/alpha/alpha.obj"], liveries: ["blue lines", "brown waves", "classic", "plain white"] },
}

/** ACF datum → nominal CG, feet; extracted from each installed .acf on
 * 2026-09-13. All listed exterior attachments are zero-rotation. The SR22
 * alone uses a nonzero attachment translation (also feet). Geometry remains
 * at native metre scale; it is never stretched to another variant. */
export const XP_PLACEMENT: Record<string, { cgFt: [number, number, number]; attachmentFt?: [number, number, number] }> = {
  C172: { cgFt: [0, .300000012, 2.900000095] },
  B738: { cgFt: [0, -2, 59.5] },
  A333: { cgFt: [0, -3.279999971, 97] },
  MD82: { cgFt: [0, -2.75, 75] },
  SR22: { cgFt: [0, 0, .050000001], attachmentFt: [0, -3.937007904, 1.148293972] },
  BE58: { cgFt: [0, -.200000003, 9.649999619] },
  PA18: { cgFt: [0, 0, .649999976] },
  AS21: { cgFt: [0, .5, 10.75] },
  C750: { cgFt: [0, 1, 35.75] },
}

/** Authored ACF control travel in degrees; OBJ key ranges are calibration,
 * not physical limits (many use 0→0°, 1→1°). */
export const XP_CONTROL_LIMITS: Record<string, Record<string, number>> = {
  "C172": {
    "flap1": 30.0,
    "flap2": 0.0,
    "aileron1": 20.0,
    "aileron2": 0.0,
    "speedbrake1": 0.0,
    "speedbrake2": 0.0,
    "spoiler1": 0.0,
    "spoiler2": 0.0
  },
  "B738": {
    "flap1": 40.0,
    "flap2": 40.0,
    "aileron1": 20.0,
    "aileron2": 0.0,
    "speedbrake1": 52.0,
    "speedbrake2": 60.0,
    "spoiler1": 38.0,
    "spoiler2": 33.0
  },
  "A333": {
    "flap1": 32.0,
    "flap2": 32.0,
    "aileron1": 25.0,
    "aileron2": 25.0,
    "speedbrake1": 35.0,
    "speedbrake2": 35.0,
    "spoiler1": 35.0,
    "spoiler2": 35.0
  },
  "MD82": {
    "flap1": 40.0,
    "flap2": 40.0,
    "aileron1": 25.0,
    "aileron2": 0.0,
    "speedbrake1": 60.0,
    "speedbrake2": 0.0,
    "spoiler1": 35.0,
    "spoiler2": 35.0
  },
  "SR22": {
    "flap1": 30.0,
    "flap2": 0.0,
    "aileron1": 30.0,
    "aileron2": 0.0,
    "speedbrake1": 90.0,
    "speedbrake2": 0.0,
    "spoiler1": 0.0,
    "spoiler2": 0.0
  },
  "BE58": {
    "flap1": 30.0,
    "flap2": 30.0,
    "aileron1": 18.0,
    "aileron2": 0.0,
    "speedbrake1": 0.0,
    "speedbrake2": 0.0,
    "spoiler1": 0.0,
    "spoiler2": 0.0
  },
  "PA18": {
    "flap1": 50.0,
    "flap2": 0.0,
    "aileron1": 18.0,
    "aileron2": 0.0,
    "speedbrake1": 0.0,
    "speedbrake2": 0.0,
    "spoiler1": 0.0,
    "spoiler2": 0.0
  },
  "AS21": {
    "flap1": 90.0,
    "flap2": 0.0,
    "aileron1": 29.0,
    "aileron2": 0.0,
    "speedbrake1": 95.0,
    "speedbrake2": 0.0,
    "spoiler1": 0.0,
    "spoiler2": 0.0
  },
  "C750": {
    "flap1": 35.0,
    "flap2": 0.0,
    "aileron1": 25.0,
    "aileron2": 0.0,
    "speedbrake1": 40.0,
    "speedbrake2": 0.0,
    "spoiler1": 35.0,
    "spoiler2": 35.0
  }
}

/** ACF travel (up/down, left/right degrees), with physical sides verified
 * against each authored OBJ's indexed exterior geometry. Never infer parity:
 * an array index identifies a wing station, not a physical side contract. */
export const XP_SURFACE_CALIBRATION: Record<string, {
  aileron: [number, number]; elevator: [number, number]; rudder: [number, number]
  leftAilerons: number[]; rightAilerons: number[]
  stabilizer?: [number, number]; stabilizerSign?: number; rudder2?: number
}> = {
  C172: {aileron:[20,15], elevator:[20,15], rudder:[20,20], leftAilerons:[2], rightAilerons:[3]},
  B738: {aileron:[20,16], elevator:[20,22], rudder:[29,29], leftAilerons:[4], rightAilerons:[5], stabilizer:[8.5,8.5]},
  A333: {aileron:[25,25], elevator:[30,15], rudder:[35,35], leftAilerons:[], rightAilerons:[], stabilizer:[8,8]},
  SR22: {aileron:[30,10], elevator:[25,20], rudder:[15,15], leftAilerons:[4], rightAilerons:[5]},
  BE58: {aileron:[18,12], elevator:[25,20], rudder:[27,27], leftAilerons:[2], rightAilerons:[3]},
  PA18: {aileron:[18,18], elevator:[34,29], rudder:[30,30], leftAilerons:[0], rightAilerons:[1], stabilizer:[4,2.5]},
  AS21: {aileron:[29,17], elevator:[30,15], rudder:[35,35], leftAilerons:[0], rightAilerons:[1]},
  C750: {aileron:[25,25], elevator:[27,22], rudder:[30,30], rudder2:18, leftAilerons:[2], rightAilerons:[3], stabilizer:[12,2]},
}
