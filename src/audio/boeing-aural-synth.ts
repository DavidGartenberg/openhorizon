/**
 * Procedural synthesis of the 737NG flight-deck aurals. ORIGINAL sounds
 * built from the published character of each alert (bell, two-tone wailer,
 * horn, clacker, stick shaker, chime) — no Boeing or third-party recordings
 * are used or shipped. Every generator is pure (seeded noise) and returns
 * mono samples in [-1, 1]; the loopable ones end phase-continuous so they
 * can loop with no click.
 */

/** Deterministic noise (mulberry32) so buffers are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0
  for (const v of x) m = Math.max(m, Math.abs(v))
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i]! / m) * peak
  return x
}

/** One-pole low/high pass helpers, in place. */
function lowpass(x: Float32Array, hz: number, sr: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * hz) / sr)
  let y = 0
  for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i]! + a * y; x[i] = y }
  return x
}

/** Two-pole resonator (band-pass) applied to an excitation, in place. */
function resonate(x: Float32Array, hz: number, q: number, sr: number): Float32Array {
  const w = (2 * Math.PI * hz) / sr, r = Math.exp(-w / (2 * q))
  const b1 = 2 * r * Math.cos(w), b2 = -r * r
  let y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const y = (1 - r) * x[i]! + b1 * y1 + b2 * y2
    y2 = y1; y1 = y; x[i] = y
  }
  return x
}

/** Additive tone whose instantaneous frequency is f(t); returns the loop
 *  with the carrier frequency scaled so the loop holds a whole number of
 *  carrier cycles (phase-continuous wrap). */
function sweptTone(sr: number, seconds: number, f: (t: number) => number, harmonics: readonly number[]): Float32Array {
  const n = Math.round(sr * seconds)
  let cycles = 0
  for (let i = 0; i < n; i++) cycles += f(i / sr) / sr
  const k = Math.max(1, Math.round(cycles)) / cycles
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let h = 0; h < harmonics.length; h++) s += harmonics[h]! * Math.sin(phase * (h + 1))
    out[i] = s
    phase += (2 * Math.PI * f(i / sr) * k) / sr
  }
  return out
}

/** Autopilot-disconnect WAILER: a bright two-tone warble sweeping between
 *  ≈1.0 and ≈1.5 kHz, 2.5 sweeps/s. Loop = one sweep. */
export function synthWailer(sr: number): Float32Array {
  const period = 0.4
  const f = (t: number): number => {
    const u = (t / period) % 1
    const tri = u < 0.5 ? u * 2 : 2 - u * 2
    return 1000 + 500 * (0.5 - 0.5 * Math.cos(Math.PI * tri))
  }
  return normalize(sweptTone(sr, period, f, [1, 0.35, 0.18, 0.08]), 0.8)
}

/** Warning HORN tone (gear/config): a reedy ≈ 370 Hz horn with a beating
 *  second reed, band-limited. Loop = 0.5 s, phase-continuous. */
function hornTone(sr: number, seconds: number): Float32Array {
  const a = sweptTone(sr, seconds, () => 370, [1, 0.62, 0.45, 0.3, 0.22, 0.15, 0.1, 0.07, 0.05])
  const b = sweptTone(sr, seconds, () => 374, [0.6, 0.4, 0.25, 0.15, 0.1])
  const out = new Float32Array(a.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(1.6 * (a[i]! + b[i]!))
  // Pre-roll the filter over one period so its start-up transient never
  // lands on the loop seam.
  const twice = new Float32Array(out.length * 2)
  twice.set(out); twice.set(out, out.length)
  return lowpass(twice, 3200, sr).slice(out.length)
}

/** STEADY horn (landing-gear configuration). */
export function synthSteadyHorn(sr: number): Float32Array {
  return normalize(hornTone(sr, 0.5), 0.75)
}

/** INTERMITTENT horn (takeoff configuration): the same horn keyed
 *  0.25 s on / 0.25 s off with soft 8 ms edges. */
export function synthIntermittentHorn(sr: number): Float32Array {
  const x = hornTone(sr, 0.5)
  const on = Math.round(0.25 * sr), edge = Math.round(0.008 * sr)
  for (let i = 0; i < x.length; i++) {
    const g = i >= on ? 0 : Math.min(1, i / edge, (on - i) / edge)
    x[i] = x[i]! * g
  }
  return normalize(x, 0.75)
}

/** Overspeed CLACKER: an electromechanical clapper striking ≈ 12 times a
 *  second — a sharp knock with a metallic ring. Loop = 6 strikes. */
export function synthClacker(sr: number): Float32Array {
  const strikes = 6, period = 1 / 12
  const n = Math.round(sr * period * strikes)
  const out = new Float32Array(n)
  const noise = rng(7)
  for (let s = 0; s < strikes; s++) {
    const start = Math.round(s * period * sr)
    const len = Math.round(0.03 * sr)
    const ex = new Float32Array(len)
    for (let i = 0; i < len; i++) ex[i] = noise() * Math.exp(-i / (0.0015 * sr))
    const ring = resonate(Float32Array.from(ex), 2300, 9, sr)
    const knock = resonate(Float32Array.from(ex), 620, 4, sr)
    for (let i = 0; i < len && start + i < n; i++) out[start + i] = out[start + i]! + ring[i]! * 3 + knock[i]! * 2
  }
  return normalize(out, 0.85)
}

/** STICK SHAKER: eccentric-weight motor rattling the column at ≈ 22 Hz —
 *  a low thud train with a loose-hardware buzz. Loop = 1 s (22 cycles). */
export function synthStickShaker(sr: number): Float32Array {
  const n = sr, hz = 22
  const out = new Float32Array(n)
  const noise = rng(11)
  for (let i = 0; i < n; i++) {
    const ph = (i * hz / sr) % 1
    const thud = Math.exp(-ph * 9) * Math.sin(2 * Math.PI * 66 * (ph / hz))
    out[i] = thud * 1.2 + noise() * 0.5 * Math.exp(-ph * 5)
  }
  lowpass(out, 700, sr)
  return normalize(out, 0.8)
}

/** Engine FIRE BELL: a continuously-ringing electric bell — hammer strikes
 *  at ≈ 16 Hz exciting inharmonic bell partials that keep ringing. Loop =
 *  1 s (16 strikes); the resonators are pre-rolled one loop so the wrap
 *  carries the ring-down (no gap at the loop point). */
export function synthFireBell(sr: number): Float32Array {
  const n = sr, rate = 16
  const ex = new Float32Array(n * 2)
  const noise = rng(23)
  for (let s = 0; s < rate * 2; s++) {
    const start = Math.round((s / rate) * sr)
    for (let i = 0; i < 0.002 * sr; i++) ex[start + i] = noise() * (1 - i / (0.002 * sr))
  }
  const partials: Array<[number, number, number]> = [[930, 150, 1], [2140, 170, 0.55], [3620, 180, 0.3], [5110, 200, 0.15]]
  const mix = new Float32Array(n * 2)
  for (const [hz, q, amp] of partials) {
    const r = resonate(Float32Array.from(ex), hz, q, sr)
    for (let i = 0; i < mix.length; i++) mix[i] = mix[i]! + r[i]! * amp
  }
  return normalize(mix.slice(n), 0.8)
}

/** ALTITUDE ALERT: a single momentary two-note chime (≈ C6 + E6) with a
 *  bell-like decay. One-shot, 1.3 s. */
export function synthAltitudeAlert(sr: number): Float32Array {
  const n = Math.round(1.3 * sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 3.2)
    out[i] = env * (Math.sin(2 * Math.PI * 1046.5 * t) + 0.7 * Math.sin(2 * Math.PI * 1318.5 * t) + 0.12 * Math.sin(2 * Math.PI * 2093 * t))
  }
  return normalize(out, 0.7)
}
