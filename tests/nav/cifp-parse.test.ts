import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs module without type declarations
import { parseCifpCoord, buildCifpWaypoints, buildCifpProcedures } from '../../server/parse.mjs'

/**
 * Real fixed-width ARINC 424 records from the live FAA CIFP cycle 2607
 * (`FAACIFP18`, fetched from `CIFP_260709.zip` during this task — see
 * docs/plans/phase-4-task4-report.md) — KSFO's ILS 28R approach ("H28RY")
 * plus the real terminal-waypoint/runway records needed to resolve its leg
 * fix coordinates. This is ground-truth data, not fabricated: the leg
 * sequence, fix idents, altitudes, and coordinates below must match what a
 * real ARINC 424 parser produces for this exact, well-documented approach.
 */
const KSFO_ILS28R_LEGS = `
SUSAP KSFOK2FH28RY AARCHI 010ARCHIK2PC0E  A    IF                                   07000     18000                 A FS   144081810
SUSAP KSFOK2FH28RY AARCHI 020WIBNIK2PC0E    010TF                                 + 04900                           A FS   144091505
SUSAP KSFOK2FH28RY AARCHI 030GUTTSK2PC0EE B 010TF                                 + 03400                           A FS   144101505
SUSAP KSFOK2FH28RY AEDDYY 010EDDYYK2PC0E  A    IF                                   06000     18000240              A-FS   144111804
SUSAP KSFOK2FH28RY AEDDYY 020SIDBYK2PC0E    010TF                                 + 04000                           A FS   144121804
SUSAP KSFOK2FH28RY AEDDYY 030GUTTSK2PC0EE B 010TF                                 + 03400                           A FS   144131804
SUSAP KSFOK2FH28RY ASIDBY 010SIDBYK2PC0E  A    IF                                             18000                 A FS   144141810
SUSAP KSFOK2FH28RY ASIDBY 020GUTTSK2PC0EE B 010TF                                 + 03400                           A FS   144151810
SUSAP KSFOK2FH28RY H      010GUTTSK2PC0E  I    IF                                 + 03400     18000                 A FS   144161505
SUSAP KSFOK2FH28RY H      020DONNGK2PC1E  F 010TF                                 + 01800                 RW28R K2PGA FS   144171310
`.trim()

const KSFO_WAYPOINTS = `
SUSAP KSFOK2CARCHI K20    C     N37292687W121523195                       E0127     NAR           ARCHI                    138832605
SUSAP KSFOK2CWIBNI K20    W     N37310019W122015291                       E0128     NAR           WIBNI                    139812605
SUSAP KSFOK2CGUTTS K20    W     N37324784W122092138                       E0128     NAR           GUTTS                    139172605
SUSAP KSFOK2CEDDYY K20    W     N37222965W122070750                       E0127     NAR           EDDYY                    139032605
SUSAP KSFOK2CSIDBY K20    W     N37270256W122084109                       E0128     NAR           SIDBY                    139642605
SUSAP KSFOK2CDONNG K20    W     N37351218W122150504                       E0128     NAR           DONNG                    138982605
SUSAP KSFOK2GRW28R   0118702840 N37365011W122212901         -0028700013030055200IIGWQ3                                     146152104
`.trim()

describe('CIFP (ARINC 424) parser — real KSFO ILS 28R data', () => {
  it('decodes ARINC 424 lat/lon fields (DDMMSSss / DDDMMSSss)', () => {
    // ARCHI: real published position ~37.4908 N, 121.8755 W.
    const coord = parseCifpCoord('N37292687', 'W121523195')
    expect(coord.la).toBeCloseTo(37.4908, 3)
    expect(coord.lo).toBeCloseTo(-121.8755, 3)
  })

  it('builds a waypoint index from subsection C/G records', () => {
    const wps = buildCifpWaypoints(KSFO_WAYPOINTS)
    expect(wps.get('KSFO|ARCHI')).toBeDefined()
    expect(wps.get('KSFO|RW28R')).toBeDefined()
    expect(wps.size).toBe(7)
  })

  it('parses the real KSFO H28RY leg records into IF/TF legs with correct idents, order, and altitudes', () => {
    const text = KSFO_WAYPOINTS + '\n' + KSFO_ILS28R_LEGS
    const byAirport = buildCifpProcedures(text)
    const ksfo = byAirport.get('KSFO')
    expect(ksfo).toBeDefined()
    const ils = ksfo.find((p: any) => p.n === 'H28RY')
    expect(ils).toBeDefined()
    expect(ils.y).toBe(2) // APPCH

    const transitionNames = ils.t.map((t: any) => t.tn).sort()
    expect(transitionNames).toEqual(['', 'ARCHI', 'EDDYY', 'SIDBY'])

    const archi = ils.t.find((t: any) => t.tn === 'ARCHI')
    expect(archi.l.map((l: any) => l.f)).toEqual(['ARCHI', 'WIBNI', 'GUTTS'])
    expect(archi.l.map((l: any) => l.ty)).toEqual(['IF', 'TF', 'TF'])
    expect(archi.l[0].a1).toBe(7000)
    expect(archi.l[1].a1).toBe(4900)
    expect(archi.l[1].ad).toBe('+') // at-or-above
    // Fix coordinates resolved from the subsection-C table.
    expect(archi.l[0].la).toBeCloseTo(37.4908, 3)
    expect(archi.l[0].lo).toBeCloseTo(-121.8755, 3)

    const common = ils.t.find((t: any) => t.tn === '')
    expect(common.l.map((l: any) => l.f)).toEqual(['GUTTS', 'DONNG'])
    expect(common.l.map((l: any) => l.ty)).toEqual(['IF', 'TF'])
    expect(common.l[1].a1).toBe(1800)
    // DONNG's leg carries the runway reference, resolved to real coordinates.
    expect(common.l[1].rw).toBe('RW28R')
    expect(common.l[1].rwla).toBeCloseTo(37.6139, 3)
    expect(common.l[1].rwlo).toBeCloseTo(-122.358, 3)
  })

  it('skips non-US-airport-section records and non-D/E/F subsections', () => {
    const junk = 'HDR01FAACIFP18 SOME OTHER RECORD TYPE ENTIRELY NOT AN AIRPORT PROCEDURE AT ALL PADDED OUT'
    const byAirport = buildCifpProcedures(junk + '\n' + KSFO_ILS28R_LEGS)
    expect(byAirport.get('KSFO')).toBeDefined()
    expect(byAirport.size).toBe(1)
  })
})
