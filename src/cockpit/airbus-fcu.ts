/** A330.acf's Autopilot group. Atlas sizes and gen_LED rows are authored
 * pixels, not a substitute browser font. Assets stay in the user's install. */
const path = (name: string) => `cockpit_3d/generic/7segment/Autopilot/${name}.png`
export const A333_FCU_ART = {
  digits: { path: path('wide_space_digits-4'), width: 416, height: 136 },
  altitude: { path: path('altitude_digits-4'), width: 368, height: 170 },
  vs: { path: path('vvi_digits-4'), width: 416, height: 136 },
  sign: { path: path('positive_negative-1'), width: 40, height: 22 },
  dashes: { path: path('4_dashes-1'), width: 122, height: 12 },
  speedLabel: { path: path('speed_mach-1'), width: 180, height: 22 },
  headingLabel: { path: path('HDG_TRK-1'), width: 152, height: 20 },
  lateralLabel: { path: path('LAT-1'), width: 34, height: 22 },
  altitudeLabel: { path: path('ALT_LVLCH-1'), width: 158, height: 22 },
  verticalLabel: { path: path('VS_FPA-1'), width: 136, height: 22 },
  modeLabel: { path: path('HDGVS_TRKFPA-1'), width: 212, height: 36 },
} as const
export type AirbusFcuArt = Partial<Record<keyof typeof A333_FCU_ART, CanvasImageSource>>
export interface AirbusFcuState { iasKt: number; hdgDeg: number; altFt: number; vsFpm: number; vsActive: boolean }

/** Draw selected speed/heading/altitude/VS. Managed dots/FPA are not invented
 * for a simulator that currently has no managed Airbus flight-guidance mode. */
export function drawAirbusFcu(c: CanvasRenderingContext2D, s: AirbusFcuState, art: AirbusFcuArt): void {
  c.fillStyle = '#000'; c.fillRect(1029, 896, 747, 53)
  const sprite = (key: keyof AirbusFcuArt, x: number, y: number, frames = 1, frame = 0) => {
    const img = art[key], a = A333_FCU_ART[key]
    if (!img) return
    const w = a.width / frames
    c.drawImage(img, w * frame, 0, w, a.height, x - w / 2, y - a.height / 2, w, a.height)
  }
  const digits = (key: 'digits' | 'altitude' | 'vs', text: string, x: number) => {
    const img = art[key], width = A333_FCU_ART[key].width / 16
    if (!img) {
      c.fillStyle = '#ffc961'; c.font = '25px monospace'; c.textBaseline = 'middle'; c.textAlign = 'center'
      c.fillText(text, x, 931); return
    }
    for (let i = 0; i < text.length; i++) {
      const glyph = text[i] === '-' ? 12 : Number(text[i])
      c.drawImage(img, glyph * width, i * 34, width, 34, x + (i - text.length / 2) * width, 914, width, 34)
    }
  }
  const fallback = (text: string, x: number) => {
    c.fillStyle = '#ffc961'; c.font = '25px monospace'; c.textBaseline = 'middle'; c.textAlign = 'center'
    c.fillText(text, x, 931)
  }
  sprite('speedLabel', 1090, 907, 2)
  sprite('headingLabel', 1225, 907, 2)
  sprite('lateralLabel', 1279, 907)
  sprite('altitudeLabel', 1623, 907)
  sprite('verticalLabel', 1733, 907, 2)
  sprite('modeLabel', 1401, 933, 2)
  digits('digits', String(Math.max(0, Math.min(999, Math.round(s.iasKt)))).padStart(3, '0'), 1088)
  digits('digits', String(((Math.round(s.hdgDeg) % 360) + 360) % 360).padStart(3, '0'), 1231)
  const altitude = Math.max(-9999, Math.min(99999, Math.round(s.altFt)))
  digits('altitude', altitude < 0 ? `-${String(-altitude).padStart(4, '0')}` : String(altitude).padStart(5, '0'), 1559.5)
  if (s.vsActive) {
    digits('vs', String(Math.min(9900, Math.abs(Math.round(s.vsFpm / 100) * 100))).padStart(4, '0'), 1716)
    sprite('sign', 1655, 931, 2, s.vsFpm < 0 ? 1 : 0)
    if (!art.sign) fallback(s.vsFpm < 0 ? '−' : '+', 1655)
  } else {
    sprite('dashes', 1705, 931)
    if (!art.dashes) fallback('----', 1705)
  }
}
