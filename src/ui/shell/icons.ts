/**
 * Original line icons for the shell toolbar and windows (24×24 viewBox,
 * stroke-based). Drawn for this project — no third-party icon artwork.
 */
export const ICONS: Record<string, string> = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  camera: '<rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 7l1.5-2.5h5L16 7"/>',
  atc: '<path d="M5 13v-1a7 7 0 0 1 14 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2.5-5 2.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 12l4-4"/><path d="M7 15.5h10"/><circle cx="12" cy="12" r="1"/>',
  navlog: '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  weather: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z"/>',
  fuel: '<path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15"/><path d="M4 20h11"/><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3"/><path d="M7 8h5"/>',
  controls: '<path d="M7 9h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L14 14h-4l-1.6 1.8A3 3 0 0 1 3 14v-1a4 4 0 0 1 4-4z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="16" cy="12" r=".8"/><circle cx="17.8" cy="13.8" r=".8"/>',
  assist: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  keys: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h1M11 10h1M15 10h1M7 14h10"/>',
  plane: '<path d="M12 3c.8 0 1.4.8 1.4 1.8V10l7 4v2l-7-2v4l2 1.5V21l-3.4-1-3.4 1v-1.5l2-1.5v-4l-7 2v-2l7-4V4.8C10.6 3.8 11.2 3 12 3z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  minimize: '<path d="M6 12h12"/>',
  checklist: '<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 3v3h6V3"/><path d="M8.5 11l1.6 1.6 2.9-3M8.5 17l1.6 1.6 2.9-3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13l4-5"/><circle cx="12" cy="13" r="1.2"/><path d="M6.5 17h11"/>',
  autopilot: '<path d="M3 13l7-1.5L21 5l-6 11-2.5-3.5L8 17z"/><path d="M10 11.5l2.5 1"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
}

/** Inline SVG markup for an icon name. */
export function icon(name: string, size = 22): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`
}
