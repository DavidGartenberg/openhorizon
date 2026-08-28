/**
 * Live ADS-B traffic store (14b) — pure /sim, no fetch. The caller
 * polls /api/traffic (~10 s) and feeds `ingest`; the store keeps an
 * authoritative dead-reckoned state per target and a decaying display
 * offset so a new fix blends in over ~2 s instead of teleporting.
 * Stale fixes are led forward by their provider-reported position age.
 * Targets unseen for 30 s expire; each ingest caps to the 40 nearest.
 * Live targets advance with WALL time — real aircraft ignore sim time
 * acceleration (recorded honestly in the phase plan).
 */

export interface LiveTargetWire {
  id: string
  cs: string
  t: string
  lat: number
  lon: number
  altFt: number
  gnd: boolean
  gsKt: number
  trk: number
  vsFpm: number
  ageS: number
}

export interface LiveTarget {
  id: string
  cs: string
  t: string
  /** Displayed state = authoritative DR + decaying blend offset. */
  lat: number
  lon: number
  altFt: number
  gnd: boolean
  gsKt: number
  trkDeg: number
  vsFpm: number
  lastSeenMs: number
  /** Authoritative dead-reckoned state (blend-free). */
  aLat: number
  aLon: number
  aAltFt: number
  /** Display − authoritative offset, decaying to zero (τ 0.6 s). */
  eLat: number
  eLon: number
  eAltFt: number
}

const KT = 0.514444
// 111,132 m per degree of LATITUDE (spherical mean — the old 111,319.5
// was the EQUATORIAL longitude figure, ~0.17% off in latitude);
// longitude scales by cos(lat), clamped so one bad polar ADS-B row
// can't divide position by ~0.
const M_PER_DEG_LAT = 111_132
const lonScale = (latDeg: number): number => Math.max(Math.cos((latDeg * Math.PI) / 180), 0.05)
const EXPIRE_MS = 30_000
const CAP = 40
const BLEND_TAU_S = 0.6 // ~95% of a fix jump absorbed inside 2 s

export class LiveTrafficStore {
  readonly targets = new Map<string, LiveTarget>()

  /** Feed one poll's rows at wall-time `nowMs`; own position caps by range. */
  ingest(rows: LiveTargetWire[], nowMs: number, ownLat: number, ownLon: number): void {
    const kept = rows
      .map((r) => ({
        r,
        d2:
          ((r.lat - ownLat) * M_PER_DEG_LAT) ** 2 +
          ((r.lon - ownLon) * M_PER_DEG_LAT * lonScale(ownLat)) ** 2,
      }))
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, CAP)
    const seen = new Set<string>()
    for (const { r } of kept) {
      seen.add(r.id)
      // Lead the fix forward by its reported age along its track.
      const mPerDegLon = M_PER_DEG_LAT * lonScale(r.lat)
      const leadM = r.gsKt * KT * r.ageS
      const trkRad = (r.trk * Math.PI) / 180
      const aLat = r.lat + (Math.cos(trkRad) * leadM) / M_PER_DEG_LAT
      const aLon = r.lon + (Math.sin(trkRad) * leadM) / mPerDegLon
      const aAltFt = r.altFt + (r.vsFpm / 60) * r.ageS
      const prev = this.targets.get(r.id)
      if (prev) {
        // Preserve display continuity: offset absorbs the fix jump.
        prev.eLat = prev.lat - aLat
        prev.eLon = prev.lon - aLon
        prev.eAltFt = prev.altFt - aAltFt
        prev.aLat = aLat
        prev.aLon = aLon
        prev.aAltFt = aAltFt
        prev.cs = r.cs || prev.cs
        prev.t = r.t || prev.t
        prev.gnd = r.gnd
        prev.gsKt = r.gsKt
        prev.trkDeg = r.trk
        prev.vsFpm = r.vsFpm
        prev.lastSeenMs = nowMs
      } else {
        this.targets.set(r.id, {
          id: r.id, cs: r.cs, t: r.t,
          lat: aLat, lon: aLon, altFt: aAltFt,
          gnd: r.gnd, gsKt: r.gsKt, trkDeg: r.trk, vsFpm: r.vsFpm,
          lastSeenMs: nowMs,
          aLat, aLon, aAltFt,
          eLat: 0, eLon: 0, eAltFt: 0,
        })
      }
    }
    // Cap enforcement: drop stored targets that fell outside this poll's
    // nearest-40 (they re-enter next poll if still around).
    if (this.targets.size > CAP) {
      for (const id of [...this.targets.keys()]) {
        if (!seen.has(id)) this.targets.delete(id)
        if (this.targets.size <= CAP) break
      }
    }
  }

  /** Advance dead reckoning + blend decay by wall dt; expire the unseen. */
  step(dtS: number, nowMs: number): void {
    const decay = Math.exp(-dtS / BLEND_TAU_S)
    for (const [id, t] of this.targets) {
      if (nowMs - t.lastSeenMs > EXPIRE_MS) {
        this.targets.delete(id)
        continue
      }
      const mPerDegLon = M_PER_DEG_LAT * lonScale(t.aLat)
      const stepM = t.gsKt * KT * dtS
      const trkRad = (t.trkDeg * Math.PI) / 180
      t.aLat += (Math.cos(trkRad) * stepM) / M_PER_DEG_LAT
      t.aLon += (Math.sin(trkRad) * stepM) / mPerDegLon
      t.aAltFt += (t.vsFpm / 60) * dtS
      t.eLat *= decay
      t.eLon *= decay
      t.eAltFt *= decay
      t.lat = t.aLat + t.eLat
      t.lon = t.aLon + t.eLon
      t.altFt = t.aAltFt + t.eAltFt
    }
  }
}
