import { describe, expect, it } from 'vitest'
import type { LatLon } from '../../src/math/geo'
import {
  evaluateLeg,
  evaluateIfLeg,
  evaluateTfLeg,
  evaluateDfLeg,
  evaluateCfLeg,
  evaluateAltitudeTerminatedLeg,
  evaluateHoldLeg,
  fromCifpLeg,
  assembleProcedureLegs,
  SUPPORTED_LEG_TYPES,
  type ProcLeg,
  type HoldState,
  type CifpProcedureJson,
} from '../../src/sim/nav/procedures'

// Hand-built synthetic fixtures — independent of the CIFP parser, per the
// phase plan's requirement that the leg interpreter be TDD'd regardless of
// real-data parser success. All fixtures below are clearly test-only
// geometry (nice round lat/lon offsets near KSFO), not real procedure data.
const FIX_A: LatLon & { ident: string } = { ident: 'ALPHA', lat: 37.0, lon: -122.0 }
const FIX_B = { ident: 'BRAVO', lat: 37.2, lon: -122.0 } // ~22.2 nm due north of A

describe('procedures.ts — leg interpreter (synthetic fixtures)', () => {
  describe('IF — initial fix', () => {
    it('flies direct to the fix and terminates on arrival', () => {
      const leg: ProcLeg = { type: 'IF', fix: FIX_A }
      const farAway: LatLon = { lat: 36.8, lon: -122.0 }
      const g = evaluateIfLeg(leg, farAway)
      expect(g.desiredTrackDeg).toBeCloseTo(0, 0) // due north
      expect(g.isTerminated).toBe(false)
      const onTop = evaluateIfLeg(leg, { lat: FIX_A.lat, lon: FIX_A.lon })
      expect(onTop.isTerminated).toBe(true)
    })
  })

  describe('TF — track to fix', () => {
    it('reports cross-track error and distance-to-go toward the fix', () => {
      const leg: ProcLeg = { type: 'TF', fix: FIX_B }
      const aircraft: LatLon = { lat: 37.1, lon: -122.0 }
      const g = evaluateTfLeg(leg, aircraft)
      expect(g.desiredTrackDeg).toBeCloseTo(0, 0)
      expect(g.distanceRemainingNm).toBeGreaterThan(5)
      expect(g.isTerminated).toBe(false)
    })

    it('terminates once at/over the fix', () => {
      const leg: ProcLeg = { type: 'TF', fix: FIX_B }
      const g = evaluateTfLeg(leg, { lat: FIX_B.lat, lon: FIX_B.lon })
      expect(g.isTerminated).toBe(true)
      expect(g.distanceRemainingNm).toBeCloseTo(0, 1)
    })
  })

  describe('DF — direct to fix', () => {
    it('recomputes course directly from wherever the aircraft is (not a fixed line)', () => {
      const leg: ProcLeg = { type: 'DF', fix: FIX_B }
      const west: LatLon = { lat: 37.1, lon: -122.3 }
      const east: LatLon = { lat: 37.1, lon: -121.7 }
      const gWest = evaluateDfLeg(leg, west)
      const gEast = evaluateDfLeg(leg, east)
      // Course from west of the fix should point east-of-north; from east,
      // west-of-north — i.e. genuinely different courses, unlike a fixed
      // TF/CF course line.
      expect(gWest.desiredTrackDeg).not.toBeCloseTo(gEast.desiredTrackDeg, 0)
      expect(gWest.crossTrackNm).toBe(0) // a direct-to has no course line to deviate from
    })
  })

  describe('CF — course to fix', () => {
    it('flies a specified course, reporting cross-track from that course line (not direct-to)', () => {
      // Fly course 000 (true north) to FIX_B. An aircraft east of the
      // north-south line through FIX_B should show positive (right)
      // cross-track error.
      const leg: ProcLeg = { type: 'CF', fix: FIX_B, courseDeg: 0 }
      const east: LatLon = { lat: 37.1, lon: -121.95 }
      const g = evaluateCfLeg(leg, east)
      expect(g.desiredTrackDeg).toBe(0)
      expect(g.crossTrackNm).toBeGreaterThan(0)
    })

    it('terminates once along-track distance reaches the fix', () => {
      const leg: ProcLeg = { type: 'CF', fix: FIX_B, courseDeg: 0 }
      const g = evaluateCfLeg(leg, { lat: FIX_B.lat, lon: FIX_B.lon })
      expect(g.isTerminated).toBe(true)
    })
  })

  describe('CA / FA — course to altitude', () => {
    it('CA (no fix) terminates once the target altitude is reached while climbing', () => {
      const leg: ProcLeg = { type: 'CA', courseDeg: 90, altitude: { kind: 'atOrAbove', altitudeFt: 3000 } }
      const activation: LatLon = { lat: 37.0, lon: -122.0 }
      const notYet = evaluateAltitudeTerminatedLeg(leg, activation, 1500, activation)
      expect(notYet.isTerminated).toBe(false)
      const reached = evaluateAltitudeTerminatedLeg(leg, activation, 3000, activation)
      expect(reached.isTerminated).toBe(true)
    })

    it('FA (anchored at a fix) terminates on a descent when altitude constraint is atOrBelow', () => {
      const leg: ProcLeg = { type: 'FA', fix: FIX_A, courseDeg: 180, altitude: { kind: 'atOrBelow', altitudeFt: 2000 } }
      const notYet = evaluateAltitudeTerminatedLeg(leg, FIX_A, 4000)
      expect(notYet.isTerminated).toBe(false)
      const reached = evaluateAltitudeTerminatedLeg(leg, FIX_A, 1800)
      expect(reached.isTerminated).toBe(true)
    })

    it('CA without an activationPoint and no fix throws rather than fabricating a start point', () => {
      const leg: ProcLeg = { type: 'CA', courseDeg: 90, altitude: { kind: 'atOrAbove', altitudeFt: 3000 } }
      expect(() => evaluateAltitudeTerminatedLeg(leg, FIX_A, 1000)).toThrow()
    })
  })

  describe('HM/HA/HF — simplified holds', () => {
    const holdFix = { ident: 'HOLDX', lat: 37.5, lon: -122.5 }

    it('flies the inbound leg toward the fix, then switches to outbound after passing it', () => {
      const leg: ProcLeg = { type: 'HM', fix: holdFix, courseDeg: 0, turnDirection: 'R', legLengthNm: 4 }
      let state: HoldState = { phase: 'INBOUND' }
      const farSouth: LatLon = { lat: 37.3, lon: -122.5 }
      const r1 = evaluateHoldLeg(leg, farSouth, state)
      expect(r1.guidance.desiredTrackDeg).toBe(0)
      expect(r1.nextState.phase).toBe('INBOUND')

      // Right at the fix — inbound leg terminates, sequencer flips to outbound.
      const atFix: LatLon = { lat: holdFix.lat, lon: holdFix.lon }
      const r2 = evaluateHoldLeg(leg, atFix, state)
      expect(r2.nextState.phase).toBe('OUTBOUND')

      state = r2.nextState
      const r3 = evaluateHoldLeg(leg, atFix, state)
      expect(r3.guidance.desiredTrackDeg).toBeCloseTo(180, 0) // reciprocal course
    })

    it('HA terminates once the target altitude is reached on the inbound leg', () => {
      const leg: ProcLeg = {
        type: 'HA',
        fix: holdFix,
        courseDeg: 0,
        turnDirection: 'R',
        legLengthNm: 4,
        altitude: { kind: 'atOrAbove', altitudeFt: 5000 },
      }
      const state: HoldState = { phase: 'INBOUND' }
      const farSouth: LatLon = { lat: 37.3, lon: -122.5 }
      const low = evaluateHoldLeg(leg, farSouth, state, 3000)
      expect(low.guidance.isTerminated).toBe(false)
      const high = evaluateHoldLeg(leg, farSouth, state, 5200)
      expect(high.guidance.isTerminated).toBe(true)
    })

    it('outbound leg is offset to the turn-direction side, forming a racetrack not a retrace', () => {
      const legR: ProcLeg = { type: 'HM', fix: holdFix, courseDeg: 0, turnDirection: 'R', legLengthNm: 4 }
      const legL: ProcLeg = { type: 'HM', fix: holdFix, courseDeg: 0, turnDirection: 'L', legLengthNm: 4 }
      const outboundState: HoldState = { phase: 'OUTBOUND' }
      const onCourseLine: LatLon = { lat: holdFix.lat + 0.01, lon: holdFix.lon }
      const rGuidance = evaluateHoldLeg(legR, onCourseLine, outboundState).guidance
      const lGuidance = evaluateHoldLeg(legL, onCourseLine, outboundState).guidance
      // Same physical point, opposite turn directions -> opposite-signed
      // cross-track error (the racetrack's outbound leg is on opposite
      // sides of the inbound course line).
      expect(Math.sign(rGuidance.crossTrackNm)).not.toBe(Math.sign(lGuidance.crossTrackNm))
    })
  })

  describe('evaluateLeg dispatch', () => {
    it('supports the documented leg-type subset', () => {
      expect(SUPPORTED_LEG_TYPES.has('IF')).toBe(true)
      expect(SUPPORTED_LEG_TYPES.has('TF')).toBe(true)
      expect(SUPPORTED_LEG_TYPES.has('CF')).toBe(true)
      expect(SUPPORTED_LEG_TYPES.has('DF')).toBe(true)
      expect(SUPPORTED_LEG_TYPES.has('CA')).toBe(true)
      expect(SUPPORTED_LEG_TYPES.has('FA')).toBe(true)
      expect(SUPPORTED_LEG_TYPES.has('HM')).toBe(true)
      expect(SUPPORTED_LEG_TYPES.has('HA')).toBe(true)
      expect(SUPPORTED_LEG_TYPES.has('HF')).toBe(true)
    })

    it('throws (does not silently mis-fly) unsupported leg types like RF/VA/VM/FM', () => {
      for (const ty of ['RF', 'VA', 'VM', 'VI', 'FM', 'PI']) {
        const leg: ProcLeg = { type: ty, fix: FIX_A }
        expect(() => evaluateLeg(leg, FIX_A)).toThrow()
      }
    })

    it('routes IF/TF/DF/CF to the right geometry via the single dispatch entrypoint', () => {
      const tf: ProcLeg = { type: 'TF', fix: FIX_B }
      expect(evaluateLeg(tf, { lat: 37.1, lon: -122.0 }).desiredTrackDeg).toBeCloseTo(0, 0)
    })
  })

  describe('fromCifpLeg — CIFP-JSON adapter', () => {
    it('decodes altitude description + Altitude1/2 into a typed constraint', () => {
      const atOrAbove = fromCifpLeg({ s: 10, ty: 'TF', f: 'FOO', ad: '+', a1: 4900 })
      expect(atOrAbove.altitude).toEqual({ kind: 'atOrAbove', altitudeFt: 4900 })

      const between = fromCifpLeg({ s: 20, ty: 'TF', f: 'FOO', ad: 'B', a1: 26000, a2: 22000 })
      expect(between.altitude).toEqual({ kind: 'between', altitudeFt: 26000, altitudeFt2: 22000 })

      const at = fromCifpLeg({ s: 10, ty: 'IF', f: 'FOO', a1: 7000 })
      expect(at.altitude).toEqual({ kind: 'at', altitudeFt: 7000 })

      const none = fromCifpLeg({ s: 10, ty: 'IF', f: 'FOO' })
      expect(none.altitude).toBeUndefined()
    })

    it('leaves fix undefined (not fabricated) when the parser could not resolve coordinates', () => {
      const leg = fromCifpLeg({ s: 10, ty: 'TF', f: 'UNRESOLVABLE' })
      expect(leg.fix).toBeUndefined()
      expect(leg.type).toBe('TF')
    })

    it('resolves runway references to a Waypoint when coordinates are present', () => {
      const leg = fromCifpLeg({ s: 20, ty: 'TF', f: 'DONNG', la: 37.35, lo: -122.15, rw: 'RW28R', rwla: 37.61, rwlo: -122.36 })
      expect(leg.runway).toEqual({ ident: 'RW28R', lat: 37.61, lon: -122.36 })
    })
  })

  describe('assembleProcedureLegs', () => {
    it('concatenates a named transition with the common segment', () => {
      const proc: CifpProcedureJson = {
        y: 2,
        n: 'TEST',
        t: [
          {
            tn: 'ENTRY',
            l: [
              { s: 10, ty: 'IF', f: 'ENTRYFIX', la: 37.0, lo: -122.0 },
              { s: 20, ty: 'TF', f: 'MIDFIX', la: 37.1, lo: -122.0 },
            ],
          },
          {
            tn: '',
            l: [
              { s: 10, ty: 'IF', f: 'MIDFIX', la: 37.1, lo: -122.0 },
              { s: 20, ty: 'TF', f: 'RWFIX', la: 37.2, lo: -122.0 },
            ],
          },
        ],
      }
      const legs = assembleProcedureLegs(proc, 'ENTRY')
      expect(legs.map((l) => l.fix?.ident ?? l.type)).toEqual(['ENTRYFIX', 'MIDFIX', 'MIDFIX', 'RWFIX'])
    })
  })
})
