/**
 * IEM NEXRAD composite (n0q) pixel → precipitation intensity class (pure).
 * The tile palette runs transparent → greens (light) → yellows (moderate) →
 * reds/magentas (heavy). Exact dBZ↔color tables vary by product revision,
 * so classification is by hue family, not exact palette indices — honest
 * about being a 4-level classifier, not a dBZ readout.
 * 0 = none, 1 = light, 2 = moderate, 3 = heavy.
 */
export function classifyNexradPixel(r: number, g: number, b: number, a: number): 0 | 1 | 2 | 3 {
  if (a < 40) return 0
  // Magenta/purple (extreme) and strong reds: heavy.
  if (r > 140 && b > 140 && g < 120) return 3
  if (r > 150 && g < 110 && b < 110) return 3
  // Yellow/orange band: moderate.
  if (r > 140 && g > 110 && b < 120) return 2
  // Green/cyan band (incl. light blues in n0q's low-dBZ range): light.
  if (g > 90 || b > 120) return 1
  return 1
}
