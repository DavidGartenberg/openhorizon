/**
 * Per-type cockpit profile: how each airplane's flight deck should look.
 * Every type flies the 737-quality cockpit work, tailored to what that
 * airplane actually has (published flight-deck arrangements):
 *
 *  - Transport deck (the 737NG deck, re-dressed per family): every jet plus
 *    the two-crew airliner turboprops (ATR, Dash 8, Saab 340, C-130, …).
 *    Varies by display layout (six 8-inch DUs / four, five or three large
 *    landscape DUs), sidestick vs yoke, Boeing MCP vs Airbus FCU vs a
 *    business-jet / regional flight-guidance panel, manufacturer palette,
 *    cabin size (business jets are smaller), stabilizer trim wheels,
 *    piggyback reversers, power + condition levers on turboprops, and
 *    whether an autothrottle is fitted.
 *  - GA panel (G1000 with the Boeing screen skin): every other type, with
 *    the type's own name plate, control stick / side-yoke / yoke, only the
 *    hardware it has (no flap lever on a flapless type, no electrics or
 *    starter on a hand-propped Cub, no engine controls on a glider) and an
 *    engine strip for its powerplant (piston single/twin, turboprop, none).
 *
 * Pure — unit-tested over the whole roster.
 */
import type { AircraftParams } from '../sim/aircraft/params'

export type Maker = 'boeing' | 'airbus' | 'md' | 'bombardier' | 'embraer' | 'gulfstream' | 'dassault' | 'cessna' | 'honda' | 'atr' | 'dehavilland' | 'lockheed' | 'generic'
export type DuLayoutName = 'six' | 'fourWide' | 'fiveWide' | 'threeWide'
export type GuidancePanel = 'boeing' | 'airbus' | 'generic'

export interface DeckProfile {
  maker: Maker
  du: DuLayoutName
  control: 'yoke' | 'sidestick'
  fcu: GuidancePanel
  /** Uniform cabin scale: 1 = airliner flight deck; business jets ≈ 0.85. */
  scale: number
  trimWheels: boolean
  /** Piggyback reverse levers on the thrust levers (Boeing / most jets). */
  reversers: boolean
  /** Power + condition levers and a torque / prop-RPM engine display. */
  turboprop: boolean
  engines: number
  autothrottle: boolean
}

export interface GaProfile {
  control: 'yoke' | 'stick' | 'sideyoke'
  hasFlaps: boolean
  hasElectrical: boolean
  hasEngine: boolean
  turboprop: boolean
  engines: number
  /** Panel face colour (CSS). */
  panel: string
}

export interface CockpitProfile {
  layout: 'g1000' | 'boeingNG'
  /** Name plate text, upper case. */
  placard: string
  deck?: DeckProfile
  ga?: GaProfile
}

export interface ProfileInfo {
  label: string
  powerplant: { kind: string; count?: number }
}

/** Two-crew airliner / military turboprops that get the transport deck. */
const TRANSPORT_TURBOPROPS = new Set(['AT76', 'AT45', 'DH8D', 'DH8A', 'SF34', 'JS41', 'E120', 'D328', 'B190', 'C130', 'SW4', 'D228', 'L410'])

function makerOf(d: string): Maker {
  if (/^(73|B7|B3|B73|B74|B75|B76|B77|B78)/.test(d) || d === '737') return 'boeing'
  if (/^(A3|A2|BCS)/.test(d)) return 'airbus'
  if (/^MD/.test(d)) return 'md'
  if (/^GLF/.test(d)) return 'gulfstream'
  if (/^DH8/.test(d)) return 'dehavilland'
  if (/^(CRJ|CL|GL)/.test(d)) return 'bombardier'
  if (/^(E1|E7|E5|E12)/.test(d)) return 'embraer'
  if (/^(F2|FA)/.test(d)) return 'dassault'
  if (/^(C25|C52|C56|C68|C75)/.test(d)) return 'cessna'
  if (d === 'HDJT') return 'honda'
  if (/^AT[47]/.test(d)) return 'atr'
  if (d === 'C130') return 'lockheed'
  return 'generic'
}

function duLayoutFor(d: string): DuLayoutName {
  // 737 MAX, Gulfstream PlaneView, Falcon EASy, Challenger / Citation
  // Pro Line, and the four-tube EFIS turboprops.
  if (/^(B38M|B39M|GLF5|GLF6|CL30|CL35|F2TH|FA7X|C56X|C680|DH8A|SF34|JS41|E120|B190|C130|SW4|D228|L410)$/.test(d)) return 'fourWide'
  // 787, A220, E-Jets, Citation X, Dash 8-400, Dornier 328, ATR -600.
  if (/^(B78|BCS|E17|E19|E75|C750|DH8D|D328|AT)/.test(d)) return 'fiveWide'
  // Light jets: Citation CJ / Latitude (three big displays), Phenom, HondaJet.
  if (/^(C525|C25|C68A|E50P|E55P|HDJT)/.test(d)) return 'threeWide'
  return 'six'
}

function scaleFor(d: string, maker: Maker): number {
  if (/^(C525|C25|E50P|E55P|HDJT)/.test(d)) return 0.84
  if (/^(C56X|C680|C68A|CL30|CL35|F2TH|SW4|D228|L410|B190|JS41|E120)/.test(d)) return 0.88
  if (/^(GLF|GLEX|GL5T|FA7X|C750|SF34|DH8A|D328)/.test(d)) return 0.92
  if (/^(CRJ|E1|E7)/.test(d) || maker === 'atr') return 0.95
  return 1
}

/** Stabilizer trim wheels: mechanical-trim airliners and the turboprops;
 *  fly-by-wire widebodies and electric-trim business jets have none. */
function hasTrimWheels(d: string, maker: Maker): boolean {
  if (/^(B77|B78|A35|A38|BCS)/.test(d)) return false
  if (maker === 'gulfstream' || maker === 'dassault' || maker === 'honda' || /^(GL|CL3|E50P|E55P)/.test(d)) return false
  return true
}

/** Autothrottle fitted: airliners and the larger business jets; not the
 *  turboprops, CJ-series, Phenom 100 or HondaJet. */
function hasAutothrottle(d: string, turboprop: boolean): boolean {
  if (turboprop) return false
  return !/^(C525|C25A|C25B|E50P|HDJT|C56X)$/.test(d)
}

/** GA control: the stick types (Cubs, aerobatic, warbird, Diamond, gliders)
 *  and the Cirrus side-yoke; everything else flies a yoke. */
function gaControlFor(d: string): GaProfile['control'] {
  if (/^(CUB|J3|PA18|E300|P51|DA40|DA42|AS21|DG80|LS8|DISC)$/.test(d)) return 'stick'
  if (/^SR2/.test(d)) return 'sideyoke'
  return 'yoke'
}

function gaPanelColor(d: string, turboprop: boolean): string {
  if (/^(SR2|DA4|TBM|PC12|KODI|P180|E300)/.test(d)) return '#2f3236' // charcoal glass-panel singles
  if (/^(CUB|J3|PA18|AN2|P51|DHC2)$/.test(d)) return '#4a4f45' // vintage olive-grey
  if (turboprop) return '#3d4146'
  return '#9a9d98' // Cessna / Piper / Beech light grey
}

export function cockpitProfile(designator: string, P: AircraftParams, info: ProfileInfo): CockpitProfile {
  const d = designator.toUpperCase()
  const placard = info.label.replace(/\s*\(Tier B\)\s*$/i, '').toUpperCase()
  const kind = info.powerplant.kind
  const engines = Math.max(1, Math.min(4, info.powerplant.count ?? 1))
  const isJet = kind === 'jet' || !!P.jet
  const turboprop = kind === 'turboprop'
  if (isJet || TRANSPORT_TURBOPROPS.has(d)) {
    const maker = makerOf(d)
    const sidestick = maker === 'airbus' || d === 'FA7X'
    return {
      layout: 'boeingNG',
      placard,
      deck: {
        maker,
        du: duLayoutFor(d),
        control: sidestick ? 'sidestick' : 'yoke',
        fcu: maker === 'boeing' ? 'boeing' : maker === 'airbus' ? 'airbus' : 'generic',
        scale: scaleFor(d, maker),
        trimWheels: hasTrimWheels(d, maker),
        reversers: isJet && maker !== 'airbus',
        turboprop: !isJet,
        engines: isJet ? Math.max(2, Math.min(4, P.jet?.engines ?? engines)) : Math.max(2, engines),
        autothrottle: isJet && hasAutothrottle(d, !isJet),
      },
    }
  }
  return {
    layout: 'g1000',
    placard,
    ga: {
      control: gaControlFor(d),
      hasFlaps: P.flapDetentsDeg.length > 1,
      hasElectrical: P.electrical !== false,
      hasEngine: P.fuelCapacityKg >= 1 && kind !== 'none',
      turboprop,
      engines,
      panel: gaPanelColor(d, turboprop),
    },
  }
}

/** Manufacturer palettes: panel face, glareshield, sidewall lining. */
export const PALETTES: Record<Maker, { panel: string; edge: string; glare: number; lining: number; ceiling: number; stand: number }> = {
  boeing: { panel: '#565b60', edge: '#3f4347', glare: 0x232527, lining: 0xb4b3ab, ceiling: 0xc4c3bb, stand: 0x4f5459 },
  airbus: { panel: '#55636f', edge: '#3c4650', glare: 0x283038, lining: 0xb9bdc1, ceiling: 0xc7cacd, stand: 0x4f5c68 },
  md: { panel: '#5d625e', edge: '#424643', glare: 0x262826, lining: 0xb2ad9f, ceiling: 0xc0bcaf, stand: 0x545955 },
  bombardier: { panel: '#545a61', edge: '#3d4247', glare: 0x24272b, lining: 0xbdb6a8, ceiling: 0xc9c3b6, stand: 0x4c5258 },
  embraer: { panel: '#4b5158', edge: '#363b40', glare: 0x212428, lining: 0xb9b8b2, ceiling: 0xc6c5bf, stand: 0x464c53 },
  gulfstream: { panel: '#47494d', edge: '#323437', glare: 0x1d1e20, lining: 0xc6b69b, ceiling: 0xd2c6b1, stand: 0x404246 },
  dassault: { panel: '#50555b', edge: '#383c40', glare: 0x1f2124, lining: 0xc2b59f, ceiling: 0xcfc4b0, stand: 0x484d53 },
  cessna: { panel: '#4c5054', edge: '#35383b', glare: 0x1f2124, lining: 0xc0b39c, ceiling: 0xccc1ad, stand: 0x45494d },
  honda: { panel: '#3f4247', edge: '#2c2e31', glare: 0x1c1d20, lining: 0xc9c0b0, ceiling: 0xd3cbbd, stand: 0x3a3d41 },
  atr: { panel: '#5a6772', edge: '#414b54', glare: 0x262b30, lining: 0xb8bcbf, ceiling: 0xc5c8ca, stand: 0x525e69 },
  dehavilland: { panel: '#535a60', edge: '#3b4045', glare: 0x24272a, lining: 0xb7b5ad, ceiling: 0xc4c2ba, stand: 0x4b5157 },
  lockheed: { panel: '#4f5852', edge: '#384039', glare: 0x222622, lining: 0x8d9488, ceiling: 0x9aa195, stand: 0x47504a },
  generic: { panel: '#565b60', edge: '#3f4347', glare: 0x232527, lining: 0xb4b3ab, ceiling: 0xc4c3bb, stand: 0x4f5459 },
}
