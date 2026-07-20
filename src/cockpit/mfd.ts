/**
 * G1000 Multi-Function Display (Phase 3 §8.3 / Task 2c): canvas-2D draw
 * function, pure `(ctx, width, height, data) => void`, mirrors `pfd.ts`'s
 * shape and pattern — pure layout-math functions (bar-gauge fractions, map
 * projection, softkey geometry) separated from and used by the actual
 * `ctx.fillRect`/`ctx.arc` draw calls. Pure math is unit-tested in
 * `tests/cockpit/mfd.test.ts`; draw calls are exempt (Vitest runs in a
 * `node` environment, no real canvas/DOM).
 *
 * EIS strip (§8.3): RPM/fuel-flow/oil-temp-press/EGT+CHT bars w/ lean-assist,
 * fuel qty L/R, volts/amps — always visible regardless of which MFD page is
 * selected, matching the real G1000's layout (engine strip runs down the
 * left side of the MFD on every page).
 *
 * Oil temp / oil pressure / CHT: these didn't exist anywhere in the sim
 * before this task. Rather than fake a plausible-looking needle position,
 * `src/sim/systems/engine-temps.ts` adds a small honest first-order
 * thermal-lag model (this task's option (a) — see that file's header and
 * the task report for the sourcing caveats on its constants). EGT reuses
 * `mixture.ts`'s existing `egtC` curve directly — no separate model needed.
 *
 * Map page: reuses Phase 2's world data (`TileManager`/`Airports`) via
 * caller-supplied query results (see `MfdMapInput`) rather than importing
 * those three.js-backed classes directly here, so the "which airports are
 * in range, what to draw where" logic stays a pure, three.js-free function
 * that's unit-testable on its own. No airspace/traffic overlays (Phase
 * 4/6 per the phase plan's deviations).
 *
 * FPL page: visual skeleton only — header + column labels + an honest
 * "NO ACTIVE FLIGHT PLAN" empty state. No real flight-plan logic (Phase 4).
 *
 * Layout, softkey labels, gauge ranges, and any other value with no in-repo
 * source are flagged as assumptions in comments below and in the task
 * report, same policy as `pfd.ts`.
 */
import { C172S } from '../sim/aircraft/c172s'
import { egtC, EGT_PEAK_C } from '../sim/systems/mixture'
import { kgToGal, TANK_CAPACITY_GAL } from '../sim/systems/fuel'
import type { EngineTemps } from '../sim/systems/engine-temps'
import { OIL_TEMP_MAX_C, OIL_PRESS_MAX_PSI, OIL_PRESS_MIN_GREEN_PSI, CHT_MAX_C } from '../sim/systems/engine-temps'
import { FT } from '../sim/atmosphere'
import { distanceM, bearingDeg, type LatLon } from '../math/geo'
import { pointInPolygonRings, AirspaceKind, type AirspacePolygon } from '../sim/nav/airspace'
import type { SoftkeyRegion } from './types'

// ============================================================================
// Pure math (unit-tested in tests/cockpit/mfd.test.ts) — no ctx/canvas here.
// ============================================================================

/** Fraction [0,1] of `value` between `min` and `max`, clamped — the shared
 *  scaling math behind every EIS bar gauge (RPM/FF/oil/CHT/EGT). */
export function barGaugeFraction(value: number, min: number, max: number): number {
  if (max === min) return 0
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

// RPM bar gauge range: 0 up to a bit past redline so the redline mark isn't
// pinned at the very top of the bar. Upper bound is a layout choice (no POH
// gauge-face spec in this repo), flagged as an assumption.
export const RPM_GAUGE_MAX = 3000

/** Fraction of the RPM bar gauge that is filled, and where the redline mark sits, both in [0,1]. */
export function rpmGaugeFractions(rpm: number, redlineRpm: number): { valueFrac: number; redlineFrac: number } {
  return {
    valueFrac: barGaugeFraction(rpm, 0, RPM_GAUGE_MAX),
    redlineFrac: barGaugeFraction(redlineRpm, 0, RPM_GAUGE_MAX),
  }
}

/** Fuel quantity (kg) -> a display gallons + gauge fraction pair, reusing fuel.ts's own kg/gal conversion. */
export function fuelQtyGauge(kg: number): { gal: number; frac: number } {
  const gal = kgToGal(kg)
  return { gal, frac: barGaugeFraction(gal, 0, TANK_CAPACITY_GAL) }
}

/** How close (°C) the current EGT is to the modeled peak-EGT point — the
 *  lean-assist page's headline number. 0 at peak, positive on either side
 *  (rich-of-peak or lean-of-peak) since `egtC` isn't monotonic. */
export function egtDeltaFromPeakC(mixture: number): number {
  return EGT_PEAK_C - egtC(mixture)
}

// ---- Map page pure geometry ----

/** A minimal airport shape for the map page — deliberately independent of
 *  `world/airports.ts`'s `AirportData` (which carries three.js-adjacent
 *  runway/render detail this display doesn't need) so this module and its
 *  tests have zero dependency on the world/three.js layer. Callers map
 *  `Airports.near(...)` results onto this shape. */
export interface MapAirport {
  id: string
  name: string
  lat: number
  lon: number
}

/** Filter a candidate airport list down to those within `rangeM` of the aircraft. Pure — no drawing. */
export function filterAirportsInRange(aircraft: LatLon, airports: readonly MapAirport[], rangeM: number): MapAirport[] {
  return airports.filter((ap) => distanceM(aircraft, { lat: ap.lat, lon: ap.lon }) <= rangeM)
}

/**
 * Project a target lat/lon to a position relative to the aircraft on the
 * map, in a unit disc (x/y each in [-1, 1], scaled to `rangeM`); the caller
 * multiplies by the on-screen radius in pixels. Returns null if the target
 * is beyond `rangeM` (off the displayed range ring). North-up when
 * `trackUp` is false (0° heading points up); track-up rotates the whole
 * picture so the aircraft's current heading always points up.
 */
export function projectToMap(
  aircraft: LatLon,
  target: LatLon,
  headingDeg: number,
  rangeM: number,
  trackUp: boolean,
): { x: number; y: number } | null {
  const dist = distanceM(aircraft, target)
  if (dist > rangeM) return null
  const brg = bearingDeg(aircraft, target)
  const angleDeg = trackUp ? brg - headingDeg : brg
  const angleRad = (angleDeg * Math.PI) / 180
  const r = dist / rangeM
  return { x: r * Math.sin(angleRad), y: -r * Math.cos(angleRad) }
}

// ---- Glide-range ring (Phase 4 Task 6) ----

/** Best-glide L/D ratio, reused directly from the C172S's own POH-validated
 *  figure (`tests/validate/poh.test.ts`'s "glides ~9:1 ±0.8 at 68 KIAS,
 *  power idle", also recorded in `PROGRESS.md`) — not a re-guessed number.
 *  `C172S.vSpeeds.glide` (68 KIAS) is the speed to fly to achieve it; the
 *  ratio itself isn't stored on the params object (it's a *result* of the
 *  flight model, validated by that POH test, not an input parameter), so
 *  it's restated here with its source cited rather than silently assumed. */
export const BEST_GLIDE_RATIO = 9

/**
 * Wind-agnostic best-glide footprint radius (m): horizontal distance
 * = altitude AGL * glide ratio. This is an honest simplification (a circle,
 * not a wind-drifted ellipse) — real glide range is skewed downwind, but
 * modeling that would need a wind-drift shaping pass this task's scope
 * doesn't cover; flagged here rather than silently presented as
 * wind-corrected. Pure — no drawing.
 */
export function glideRangeRadiusM(altAglFt: number, glideRatio = BEST_GLIDE_RATIO): number {
  return Math.max(altAglFt, 0) * glideRatio * FT
}

// ---- Airspace overlay (Phase 4 Task 5, §6.5) ----

/**
 * Filter candidate airspace polygons down to those relevant to the
 * displayed map range: either a ring vertex sits within `rangeM` of the
 * aircraft, or the aircraft itself is inside the polygon (covers the case
 * of a polygon whose vertices are all outside `rangeM` but which still
 * surrounds the aircraft — not expected for the FAA airspace shapes this
 * task renders, but a cheap, correct check to have). Pure — no drawing,
 * mirrors `filterAirportsInRange`.
 */
export function filterAirspaceInRange(
  aircraft: LatLon,
  polygons: readonly AirspacePolygon[],
  rangeM: number,
): AirspacePolygon[] {
  return polygons.filter((poly) => {
    if (pointInPolygonRings(aircraft.lon, aircraft.lat, poly.r)) return true
    const exterior = poly.r[0]
    if (!exterior) return false
    return exterior.some(([lon, lat]) => distanceM(aircraft, { lat, lon }) <= rangeM)
  })
}

/**
 * Same projection math as `projectToMap`, but never clips to `rangeM` —
 * used for airspace polygon edges, which can be worth drawing even when
 * some of their vertices fall outside the displayed range (a shelf that
 * straddles the range ring should still show the portion that's in view,
 * not disappear entirely). Pure, no drawing.
 */
export function projectToMapUnclipped(
  aircraft: LatLon,
  target: LatLon,
  headingDeg: number,
  rangeM: number,
  trackUp: boolean,
): { x: number; y: number } {
  const dist = distanceM(aircraft, target)
  const brg = bearingDeg(aircraft, target)
  const angleDeg = trackUp ? brg - headingDeg : brg
  const angleRad = (angleDeg * Math.PI) / 180
  const r = dist / rangeM
  return { x: r * Math.sin(angleRad), y: -r * Math.cos(angleRad) }
}

/** One sampled elevation-grid point around the aircraft, in NED-meter
 *  offsets, for simple terrain shading on the map page. */
export interface MapElevationOffset {
  nOffsetM: number
  eOffsetM: number
}

/**
 * A small square grid of sample offsets (NED meters from the aircraft)
 * spanning ±`rangeM`. Pure — the caller resolves each offset to a lat/lon
 * (e.g. via `WorldFrame`/`fromNedMeters`) and queries
 * `TileManager.elevationAt` to fill in the elevation before passing samples
 * back into `drawMfd`'s map input, keeping this module three.js-free.
 */
export function mapElevationGridOffsets(rangeM: number, cellsPerAxis = 6): MapElevationOffset[] {
  const out: MapElevationOffset[] = []
  const step = (rangeM * 2) / cellsPerAxis
  for (let i = 0; i < cellsPerAxis; i++) {
    for (let j = 0; j < cellsPerAxis; j++) {
      out.push({ nOffsetM: -rangeM + step * (i + 0.5), eOffsetM: -rangeM + step * (j + 0.5) })
    }
  }
  return out
}

/** Simple elevation -> color ramp for map terrain shading (a simplified,
 *  2D-map version of the color idea `world/tiles.ts`'s terrain shader
 *  already uses — banded rather than shaded/lit, since this is a flat
 *  moving-map, not a 3D scene). Bands are a reasonable representative
 *  choice, not a sourced cartographic standard. */
export function elevationColor(elevM: number): string {
  if (elevM < 0) return '#1c3f52' // below sea level / water-ish
  if (elevM < 300) return '#2f4d2a' // lowland green
  if (elevM < 900) return '#5a4a2c' // foothill brown
  if (elevM < 1800) return '#7a6a52' // highland
  return '#d8d8d8' // peaks
}

export interface MapElevationSample extends MapElevationOffset {
  elevM: number
}

export interface MfdMapInput {
  aircraftLat: number
  aircraftLon: number
  headingDeg: number
  /** Displayed range ring radius, meters. */
  rangeM: number
  trackUp: boolean
  /** Candidate airports — filtered to `rangeM` internally via `filterAirportsInRange`, so callers may pass a wider query result. */
  airports: readonly MapAirport[]
  /** Optional terrain-shading samples, pre-resolved via `mapElevationGridOffsets` + `TileManager.elevationAt`. */
  elevationSamples?: readonly MapElevationSample[]
  /** Optional airspace polygons (Class B/C/D/E-surface + SUA) — filtered to
   *  `rangeM` internally via `filterAirspaceInRange`, so callers may pass
   *  the whole nationwide `/api/airspace.json` array unfiltered. */
  airspace?: readonly AirspacePolygon[]
  /** Aircraft height above ground, ft — draws a best-glide range ring
   *  (`glideRangeRadiusM`) when supplied. Omitted = ring not drawn (e.g.
   *  AGL unknown/not computed by the caller). */
  aircraftAglFt?: number
  /** FIS-B NEXRAD cells (offsets from aircraft, meters) — drawn as the
   *  standard green/yellow/red overlay. Optional. */
  radarCells?: readonly { dNorthM: number; dEastM: number; intensity: 1 | 2 | 3 }[]
  /** Age of the radar picture, minutes — stamped on the map (the datalink
   *  picture lags reality; §11). null/omitted = no radar data yet. */
  radarAgeMin?: number | null
  /** TCAS/TAS traffic (offsets from aircraft, meters): standard symbology —
   *  hollow diamond, amber circle when alerted; ±relative altitude tag. */
  trafficDots?: readonly { dNorthM: number; dEastM: number; relAltFt: number; alerted: boolean }[]
}

// ============================================================================
// Softkeys
// ============================================================================

// Representative MFD softkey label set (bottom bezel row). Real G1000 MFD
// bezels carry ~12 keys whose exact production label set isn't in this
// repo, so — like `pfd.ts`'s `PFD_SOFTKEY_LABELS` — this is a reasonable
// representative set, functionally inert this task (a later 3D-cockpit
// interaction task raycasts against these regions).
export const MFD_SOFTKEY_LABELS: readonly string[] = [
  'MFD',
  'INSET',
  'DCLTR',
  'TERRAIN',
  'CHKLIST',
  'RANGE-',
  'RANGE+',
  'MAP',
  'ENGINE',
  'FPL',
  'NRST',
  'ALERTS',
]

/** Softkey bezel row height, shared by `mfdSoftkeyRegions` and `drawMfd` so the two never drift apart. */
export const MFD_SOFTKEY_ROW_HEIGHT_FRAC = 0.045

/** Click-target rectangles for the MFD softkey bezel row (mirrors `pfdSoftkeyRegions`). */
export function mfdSoftkeyRegions(width: number, height: number): SoftkeyRegion[] {
  const rowH = height * MFD_SOFTKEY_ROW_HEIGHT_FRAC
  const y = height - rowH
  const n = MFD_SOFTKEY_LABELS.length
  const w = width / n
  return MFD_SOFTKEY_LABELS.map((label, i) => ({ label, x: i * w, y, w, h: rowH }))
}

// ============================================================================
// Input shape
// ============================================================================

export type MfdPage = 'map' | 'lean' | 'fpl'

export interface MfdInput {
  page: MfdPage

  // EIS (always visible)
  rpm: number
  fuelFlowGph: number
  /** Controls.mixture convention: 1 = full rich, 0 = idle cutoff. Feeds `egtC` directly. */
  mixture: number
  engineTemps: EngineTemps
  fuelLeftKg: number
  fuelRightKg: number
  electrical: {
    busVoltage: number
    alternatorAmps: number
    batteryAmps: number
  }

  // Map page (only read when page === 'map')
  map?: MfdMapInput
}

// ============================================================================
// Drawing
// ============================================================================

const COLORS = {
  bg: '#0a0a0a',
  bezel: '#1c1c1c',
  bezelText: '#c8c8c8',
  tapeText: '#ffffff',
  white: '#ffffff',
  green: '#00c000',
  yellow: '#e0c000',
  red: '#d02020',
  cyan: '#20c0e0',
  magenta: '#d020c0',
  dim: '#606060',
  gaugeBg: '#181818',
}

/** Generic horizontal bar gauge: label, numeric readout, filled bar with an optional redline tick. */
function drawBarGauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  valueText: string,
  frac: number,
  redlineFrac: number | null,
  barColor: string,
): void {
  ctx.fillStyle = COLORS.tapeText
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${Math.round(h * 0.32)}px monospace`
  ctx.fillText(label, x, y + h * 0.35)
  ctx.textAlign = 'right'
  ctx.fillText(valueText, x + w, y + h * 0.35)
  ctx.textAlign = 'left'

  const barY = y + h * 0.5
  const barH = h * 0.4
  ctx.fillStyle = COLORS.gaugeBg
  ctx.fillRect(x, barY, w, barH)
  ctx.fillStyle = barColor
  ctx.fillRect(x, barY, w * Math.max(0, Math.min(1, frac)), barH)
  ctx.strokeStyle = COLORS.bezelText
  ctx.strokeRect(x, barY, w, barH)

  if (redlineFrac !== null) {
    const rx = x + w * Math.max(0, Math.min(1, redlineFrac))
    ctx.strokeStyle = COLORS.red
    ctx.lineWidth = Math.max(2, barH * 0.15)
    ctx.beginPath()
    ctx.moveTo(rx, barY)
    ctx.lineTo(rx, barY + barH)
    ctx.stroke()
  }
}

/** EIS strip — always visible along the left side, regardless of page. */
function drawEis(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: MfdInput): void {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = COLORS.bezelText
  ctx.strokeRect(x, y, w, h)

  const pad = w * 0.06
  const gx = x + pad
  const gw = w - pad * 2
  const rowH = h * 0.088
  let gy = y + h * 0.02

  const { valueFrac: rpmFrac, redlineFrac } = rpmGaugeFractions(data.rpm, C172S.redlineRpm)
  drawBarGauge(ctx, gx, gy, gw, rowH, 'RPM', data.rpm.toFixed(0), rpmFrac, redlineFrac, rpmFrac >= redlineFrac ? COLORS.red : COLORS.green)
  gy += rowH * 1.15

  // Fuel flow: no redline (a low-side/high-side caution range isn't sourced
  // here), gauge span is a generous headroom above typical cruise FF.
  const FF_GAUGE_MAX = 20
  drawBarGauge(ctx, gx, gy, gw, rowH, 'FF GPH', data.fuelFlowGph.toFixed(1), barGaugeFraction(data.fuelFlowGph, 0, FF_GAUGE_MAX), null, COLORS.cyan)
  gy += rowH * 1.15

  const oilTempFrac = barGaugeFraction(data.engineTemps.oilTempC, 0, OIL_TEMP_MAX_C)
  drawBarGauge(ctx, gx, gy, gw, rowH, 'OIL T C', data.engineTemps.oilTempC.toFixed(0), oilTempFrac, barGaugeFraction(OIL_TEMP_MAX_C, 0, OIL_TEMP_MAX_C), oilTempFrac > 0.9 ? COLORS.yellow : COLORS.green)
  gy += rowH * 1.15

  const oilPressFrac = barGaugeFraction(data.engineTemps.oilPressPsi, 0, OIL_PRESS_MAX_PSI)
  const oilPressLowFrac = barGaugeFraction(OIL_PRESS_MIN_GREEN_PSI, 0, OIL_PRESS_MAX_PSI)
  const oilPressColor = data.engineTemps.oilPressPsi < OIL_PRESS_MIN_GREEN_PSI ? COLORS.yellow : COLORS.green
  drawBarGauge(ctx, gx, gy, gw, rowH, 'OIL PSI', data.engineTemps.oilPressPsi.toFixed(0), oilPressFrac, oilPressLowFrac, oilPressColor)
  gy += rowH * 1.15

  const egt = egtC(data.mixture)
  const EGT_GAUGE_MAX = 900 // °C, headroom above the modeled peak (EGT_PEAK_C ≈732)
  drawBarGauge(ctx, gx, gy, gw, rowH, 'EGT C', egt.toFixed(0), barGaugeFraction(egt, 0, EGT_GAUGE_MAX), null, COLORS.yellow)
  gy += rowH * 1.15

  const chtFrac = barGaugeFraction(data.engineTemps.chtC, 0, CHT_MAX_C)
  drawBarGauge(ctx, gx, gy, gw, rowH, 'CHT C', data.engineTemps.chtC.toFixed(0), chtFrac, barGaugeFraction(CHT_MAX_C, 0, CHT_MAX_C), chtFrac > 0.9 ? COLORS.yellow : COLORS.green)
  gy += rowH * 1.3

  // Fuel qty L/R.
  const left = fuelQtyGauge(data.fuelLeftKg)
  const right = fuelQtyGauge(data.fuelRightKg)
  drawBarGauge(ctx, gx, gy, gw, rowH, 'FUEL L GAL', left.gal.toFixed(1), left.frac, null, COLORS.white)
  gy += rowH * 1.15
  drawBarGauge(ctx, gx, gy, gw, rowH, 'FUEL R GAL', right.gal.toFixed(1), right.frac, null, COLORS.white)
  gy += rowH * 1.3

  // Volts/amps — plain readouts, not bar gauges (matches real G1000 EIS treatment).
  ctx.font = `${Math.round(rowH * 0.4)}px monospace`
  ctx.fillStyle = COLORS.tapeText
  ctx.textAlign = 'left'
  ctx.fillText(`VOLTS  ${data.electrical.busVoltage.toFixed(1)}`, gx, gy + rowH * 0.35)
  ctx.fillText(`AMPS A ${data.electrical.alternatorAmps.toFixed(0)}`, gx, gy + rowH * 0.75)
  ctx.fillText(`AMPS B ${data.electrical.batteryAmps.toFixed(0)}`, gx, gy + rowH * 1.15)
}

/** Lean-assist detail: EGT curve readout + delta-from-peak, surfacing the real `egtC` peak. */
function drawLeanPage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: MfdInput): void {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `bold ${Math.round(h * 0.05)}px monospace`
  ctx.textAlign = 'left'
  ctx.fillText('LEAN ASSIST', x + w * 0.03, y + h * 0.08)

  const egt = egtC(data.mixture)
  const delta = egtDeltaFromPeakC(data.mixture)
  const nearPeak = Math.abs(delta) < 15 // °C band, flagged assumption for "near peak" highlight

  ctx.font = `${Math.round(h * 0.05)}px monospace`
  ctx.fillText(`EGT: ${egt.toFixed(0)} C`, x + w * 0.03, y + h * 0.2)
  ctx.fillStyle = nearPeak ? COLORS.green : COLORS.yellow
  ctx.fillText(`${delta >= 0 ? '-' : '+'}${Math.abs(delta).toFixed(0)} C FROM PEAK`, x + w * 0.03, y + h * 0.28)

  // Simple EGT-vs-mixture curve trace, sweeping the real egtC() shape rather
  // than faking a needle — a direct visualization of the modeled curve.
  const plotX = x + w * 0.03
  const plotY = y + h * 0.36
  const plotW = w * 0.94
  const plotH = h * 0.5
  ctx.strokeStyle = COLORS.bezelText
  ctx.strokeRect(plotX, plotY, plotW, plotH)
  ctx.strokeStyle = COLORS.yellow
  ctx.lineWidth = 2
  ctx.beginPath()
  const N = 100
  for (let i = 0; i <= N; i++) {
    const m = i / N // idle cutoff (0) -> full rich (1)
    const e = egtC(m)
    const px = plotX + (i / N) * plotW
    const py = plotY + plotH - barGaugeFraction(e, 0, 900) * plotH
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()

  // Current-mixture marker.
  const curX = plotX + data.mixture * plotW
  const curY = plotY + plotH - barGaugeFraction(egt, 0, 900) * plotH
  ctx.fillStyle = nearPeak ? COLORS.green : COLORS.magenta
  ctx.beginPath()
  ctx.arc(curX, curY, Math.max(4, plotH * 0.025), 0, Math.PI * 2)
  ctx.fill()
}

/** Airspace stroke/fill styling per §6.5: Class B solid blue, Class C solid
 *  magenta, Class D dashed blue, SUA (restricted/prohibited/MOA/alert/
 *  warning/danger) hatched. Not a sourced sectional-chart color table (no
 *  in-repo spec) — a reasonable representative chart-style scheme, same
 *  caveat as the rest of this file's layout/color choices. */
function airspaceStrokeStyle(kind: AirspaceKind): { color: string; dash: number[] } {
  switch (kind) {
    case AirspaceKind.ClassB:
      return { color: '#3060ff', dash: [] }
    case AirspaceKind.ClassC:
      return { color: COLORS.magenta, dash: [] }
    case AirspaceKind.ClassD:
      return { color: '#3060ff', dash: [6, 4] }
    case AirspaceKind.ClassESfc:
      return { color: '#a060ff', dash: [2, 3] }
    default:
      return { color: COLORS.yellow, dash: [] } // SUA: hatched fill carries the type, outline is a plain solid yellow
  }
}

/** Draw one airspace polygon's exterior ring plus (for Class D) a small
 *  floor/ceiling label box near the shape's first vertex. `project` maps a
 *  lat/lon to unit-disc x/y (same convention as `projectToMap`/
 *  `projectToMapUnclipped`). */
function drawAirspacePolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  poly: AirspacePolygon,
  project: (lat: number, lon: number) => { x: number; y: number },
): void {
  const ring = poly.r[0]
  if (!ring || ring.length < 3) return
  const pts = ring.map(([lon, lat]) => {
    const p = project(lat, lon)
    return { px: cx + p.x * radiusPx, py: cy + p.y * radiusPx }
  })

  const { color, dash } = airspaceStrokeStyle(poly.k)
  const isSua = poly.k >= AirspaceKind.Restricted

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(pts[0]!.px, pts[0]!.py)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.px, pts[i]!.py)
  ctx.closePath()

  if (isSua) {
    // Hatched fill: a simple diagonal-line clip pattern rather than an
    // actual repeating-tile canvas pattern — visually reads as "hatched"
    // without needing an offscreen pattern canvas.
    ctx.save()
    ctx.clip()
    const xs = pts.map((p) => p.px)
    const ys = pts.map((p) => p.py)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    const step = Math.max(4, radiusPx * 0.03)
    for (let d = minX - (maxY - minY); d < maxX; d += step) {
      ctx.beginPath()
      ctx.moveTo(d, minY)
      ctx.lineTo(d + (maxY - minY), maxY)
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.setLineDash(dash)
  ctx.strokeStyle = color
  ctx.lineWidth = isSua ? 1.5 : 2
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  if (poly.k === AirspaceKind.ClassD) {
    const ceilHundreds = Math.round(poly.ce / 100)
    const floorHundreds = Math.round(poly.fl / 100)
    const label = `${ceilHundreds}/${floorHundreds}`
    const lx = pts[0]!.px + 4
    const ly = pts[0]!.py - 4
    ctx.font = `${Math.round(radiusPx * 0.035)}px monospace`
    const textW = ctx.measureText(label).width
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(lx - 2, ly - radiusPx * 0.035, textW + 4, radiusPx * 0.045)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.strokeRect(lx - 2, ly - radiusPx * 0.035, textW + 4, radiusPx * 0.045)
    ctx.fillStyle = color
    ctx.textAlign = 'left'
    ctx.fillText(label, lx, ly)
  }
}

/** Draw every in-range airspace polygon (already filtered by the caller via
 *  `filterAirspaceInRange`). */
function drawAirspace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  map: MfdMapInput,
  polygons: readonly AirspacePolygon[],
): void {
  const aircraft: LatLon = { lat: map.aircraftLat, lon: map.aircraftLon }
  const project = (lat: number, lon: number) => projectToMapUnclipped(aircraft, { lat, lon }, map.headingDeg, map.rangeM, map.trackUp)
  for (const poly of polygons) {
    drawAirspacePolygon(ctx, cx, cy, radiusPx, poly, project)
  }
}

/** Map page: range ring, simple elevation shading, and airport symbols within range. */
function drawMapPage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, map: MfdMapInput): void {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(x, y, w, h)

  const cx = x + w / 2
  const cy = y + h / 2
  const radiusPx = Math.min(w, h) * 0.45
  const aircraft: LatLon = { lat: map.aircraftLat, lon: map.aircraftLon }

  // Terrain shading (optional — only drawn if the caller supplied samples).
  if (map.elevationSamples) {
    const cellPx = (radiusPx * 2) / 6.5 // matches mapElevationGridOffsets' default 6-cell grid, with a little overlap to avoid seams
    for (const s of map.elevationSamples) {
      const r = Math.hypot(s.nOffsetM, s.eOffsetM) / map.rangeM
      if (r > 1.05) continue
      const angleDeg = map.trackUp ? (Math.atan2(s.eOffsetM, s.nOffsetM) * 180) / Math.PI - map.headingDeg : (Math.atan2(s.eOffsetM, s.nOffsetM) * 180) / Math.PI
      const angleRad = (angleDeg * Math.PI) / 180
      const dPx = (Math.hypot(s.nOffsetM, s.eOffsetM) / map.rangeM) * radiusPx
      const px = cx + dPx * Math.sin(angleRad)
      const py = cy - dPx * Math.cos(angleRad)
      ctx.fillStyle = elevationColor(s.elevM)
      ctx.fillRect(px - cellPx / 2, py - cellPx / 2, cellPx, cellPx)
    }
  }

  // FIS-B NEXRAD overlay (§11): datalink radar, standard green/yellow/red,
  // drawn above terrain and below airspace/symbols. The age stamp below is
  // part of the product's honesty — the picture lags reality by minutes.
  if (map.radarCells) {
    // Cells arrive decimated to ~9.6 km spacing (z6 pixels × stride 4).
    const cellPx = Math.max((9600 / map.rangeM) * radiusPx, 5)
    for (const c of map.radarCells) {
      const dist = Math.hypot(c.dNorthM, c.dEastM)
      if (dist > map.rangeM * 1.05) continue
      const angleDeg = map.trackUp
        ? (Math.atan2(c.dEastM, c.dNorthM) * 180) / Math.PI - map.headingDeg
        : (Math.atan2(c.dEastM, c.dNorthM) * 180) / Math.PI
      const angleRad = (angleDeg * Math.PI) / 180
      const dPx = (dist / map.rangeM) * radiusPx
      ctx.fillStyle =
        c.intensity === 3 ? 'rgba(226,44,44,0.55)' : c.intensity === 2 ? 'rgba(233,200,44,0.5)' : 'rgba(64,190,64,0.45)'
      ctx.fillRect(cx + dPx * Math.sin(angleRad) - cellPx / 2, cy - dPx * Math.cos(angleRad) - cellPx / 2, cellPx, cellPx)
    }
  }
  if (map.radarAgeMin !== undefined && map.radarAgeMin !== null) {
    ctx.fillStyle = COLORS.yellow
    ctx.font = `${Math.round(h * 0.032)}px monospace`
    ctx.textAlign = 'right'
    ctx.fillText(`FIS-B ${map.radarAgeMin} MIN`, x + w - w * 0.015, y + h * 0.045)
  }

  // TCAS traffic symbols (§14): above radar, below airspace/rings.
  if (map.trafficDots) {
    for (const t of map.trafficDots) {
      const dist = Math.hypot(t.dNorthM, t.dEastM)
      if (dist > map.rangeM * 1.05) continue
      const angleDeg = map.trackUp
        ? (Math.atan2(t.dEastM, t.dNorthM) * 180) / Math.PI - map.headingDeg
        : (Math.atan2(t.dEastM, t.dNorthM) * 180) / Math.PI
      const aRad = (angleDeg * Math.PI) / 180
      const dPx = (dist / map.rangeM) * radiusPx
      const px = cx + dPx * Math.sin(aRad)
      const py = cy - dPx * Math.cos(aRad)
      const r = h * 0.012
      ctx.strokeStyle = t.alerted ? COLORS.yellow : COLORS.white
      ctx.fillStyle = t.alerted ? COLORS.yellow : 'transparent'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px, py - r)
      ctx.lineTo(px + r, py)
      ctx.lineTo(px, py + r)
      ctx.lineTo(px - r, py)
      ctx.closePath()
      if (t.alerted) ctx.fill()
      ctx.stroke()
      ctx.fillStyle = t.alerted ? COLORS.yellow : COLORS.white
      ctx.font = `${Math.round(h * 0.024)}px monospace`
      ctx.textAlign = 'left'
      const rel = Math.round(t.relAltFt / 100)
      ctx.fillText(`${rel >= 0 ? '+' : ''}${rel}`, px + r + 2, py + r)
    }
  }

  // Airspace boundaries (Class B/C/D/E-surface + SUA), drawn above terrain
  // shading and below the range rings/airport symbols — sectional-chart
  // convention. Optional: only drawn if the caller supplied polygons.
  if (map.airspace) {
    drawAirspace(ctx, cx, cy, radiusPx, map, filterAirspaceInRange(aircraft, map.airspace, map.rangeM))
  }

  // Range ring(s).
  ctx.strokeStyle = COLORS.bezelText
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, radiusPx * 0.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = COLORS.tapeText
  ctx.font = `${Math.round(h * 0.03)}px monospace`
  ctx.textAlign = 'left'
  ctx.fillText(`${(map.rangeM / 1852).toFixed(0)} NM`, cx + 4, cy - radiusPx + h * 0.03)

  // Best-glide range ring (Phase 4 Task 6): a wind-agnostic circle (flagged
  // simplification, see `glideRangeRadiusM`'s doc), only drawn if AGL was
  // supplied and it's smaller than the display range (otherwise it'd just
  // be a giant circle off past the edge of the screen, not useful).
  if (map.aircraftAglFt !== undefined) {
    const glideRadiusPx = (glideRangeRadiusM(map.aircraftAglFt) / map.rangeM) * radiusPx
    if (glideRadiusPx > 0 && glideRadiusPx <= radiusPx * 1.5) {
      ctx.save()
      ctx.strokeStyle = COLORS.green
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, Math.min(glideRadiusPx, radiusPx), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }
  }

  // Airports within range.
  const inRange = filterAirportsInRange(aircraft, map.airports, map.rangeM)
  for (const ap of inRange) {
    const p = projectToMap(aircraft, { lat: ap.lat, lon: ap.lon }, map.headingDeg, map.rangeM, map.trackUp)
    if (!p) continue
    const px = cx + p.x * radiusPx
    const py = cy + p.y * radiusPx
    ctx.fillStyle = COLORS.magenta
    ctx.beginPath()
    ctx.arc(px, py, Math.max(3, h * 0.01), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = COLORS.tapeText
    ctx.font = `${Math.round(h * 0.025)}px monospace`
    ctx.fillText(ap.id, px + h * 0.015, py + h * 0.008)
  }

  // Aircraft symbol, always at map center.
  ctx.save()
  ctx.translate(cx, cy)
  if (!map.trackUp) ctx.rotate((map.headingDeg * Math.PI) / 180)
  ctx.fillStyle = COLORS.white
  ctx.beginPath()
  ctx.moveTo(0, -h * 0.02)
  ctx.lineTo(-h * 0.012, h * 0.014)
  ctx.lineTo(h * 0.012, h * 0.014)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = COLORS.tapeText
  ctx.textAlign = 'left'
  ctx.font = `${Math.round(h * 0.028)}px monospace`
  ctx.fillText(map.trackUp ? 'TRK UP' : 'NORTH UP', x + w * 0.02, y + h * 0.05)
}

/** FPL page: visual skeleton only — header, column labels, honest empty state. No real flight-plan logic (Phase 4). */
function drawFplPage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = COLORS.tapeText
  ctx.textAlign = 'left'
  ctx.font = `bold ${Math.round(h * 0.05)}px monospace`
  ctx.fillText('FPL', x + w * 0.03, y + h * 0.08)

  const cols = ['WPT', 'DTK', 'DIS', 'ETE']
  const colW = w * 0.94 / cols.length
  ctx.font = `${Math.round(h * 0.03)}px monospace`
  ctx.fillStyle = COLORS.bezelText
  cols.forEach((c, i) => ctx.fillText(c, x + w * 0.03 + i * colW, y + h * 0.16))
  ctx.strokeStyle = COLORS.bezelText
  ctx.beginPath()
  ctx.moveTo(x + w * 0.03, y + h * 0.19)
  ctx.lineTo(x + w * 0.97, y + h * 0.19)
  ctx.stroke()

  ctx.fillStyle = COLORS.dim
  ctx.textAlign = 'center'
  ctx.font = `${Math.round(h * 0.035)}px monospace`
  ctx.fillText('NO ACTIVE FLIGHT PLAN', x + w / 2, y + h * 0.4)
}

/** Softkey bezel row along the bottom of the display (mirrors `pfd.ts`'s `drawSoftkeys`). */
function drawSoftkeys(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  for (const region of mfdSoftkeyRegions(width, height)) {
    ctx.fillStyle = COLORS.bezel
    ctx.fillRect(region.x, region.y, region.w, region.h)
    ctx.strokeStyle = '#000000'
    ctx.strokeRect(region.x, region.y, region.w, region.h)
    ctx.fillStyle = COLORS.bezelText
    ctx.font = `${Math.round(region.h * 0.32)}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(region.label, region.x + region.w / 2, region.y + region.h / 2)
  }
}

/**
 * Draw the full G1000 MFD into `ctx` at `width`x`height`. Pure function of
 * `data` in, pixels out. The EIS strip renders on every page; the body area
 * to its right renders whichever page is active.
 */
export function drawMfd(ctx: CanvasRenderingContext2D, width: number, height: number, data: MfdInput): void {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  const softkeyRowH = height * MFD_SOFTKEY_ROW_HEIGHT_FRAC
  const bodyH = height - softkeyRowH

  const eisW = width * 0.2
  drawEis(ctx, 0, 0, eisW, bodyH, data)

  const pageX = eisW
  const pageW = width - eisW
  if (data.page === 'map' && data.map) {
    drawMapPage(ctx, pageX, 0, pageW, bodyH, data.map)
  } else if (data.page === 'lean') {
    drawLeanPage(ctx, pageX, 0, pageW, bodyH, data)
  } else {
    drawFplPage(ctx, pageX, 0, pageW, bodyH)
  }

  drawSoftkeys(ctx, width, height)
}
