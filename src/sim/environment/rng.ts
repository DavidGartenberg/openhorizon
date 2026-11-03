/** Small deterministic helpers for the environment models (seedable so the
 *  tests are reproducible; the sim passes Math.random-backed generators). */

/** mulberry32: fast 32-bit seeded PRNG, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal sample from a uniform generator (Box–Muller). */
export function gaussian(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12)
  const v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Integer-lattice hash → [0, 1). Same inputs, same value, every run. */
export function hash2(i: number, j: number, seed = 0): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
