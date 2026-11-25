# Aircraft visuals and GitHub verification

- [x] Verify the GitHub branch, preserve local-only DG800 work, and test and
  publish the remaining Claude spoiler change (`605b952`, PR #9).
- [x] Route the full Airbus roster to the local A330-300 deck. Use its authored
  eyepoint on the native A330-300 and fit the donor deck to other Airbus noses
  without replacing those variants' exterior geometry. Wire the measured panel
  faces to live OpenHorizon instruments and connect supported manipulators.
- [x] Preserve every player Boeing variant's shape, engines, controls and
  animations when local assets are available. Transfer local Boeing texture
  detail onto their existing geometry, fitting by surface and aircraft scale.
  Keep local licensed assets and derived images out of GitHub.
- [x] Add coherent higher quality material packs and shaders with a bounded
  texture/GPU budget, visible quality options and functional fallbacks.
- [ ] Complete rendered GPU acceptance for exact/fitted cockpits, Boeing
  geometry and moving features, old-map removal, day/night and quality modes.
  Run clean committed-suite, build, validation and performance checks.
- [ ] Inspect and repair GitHub pull-request errors; verify current head SHA,
  mergeability and check results for each affected PR. Do not merge by default.
- [ ] Finish pixel-faithful main cockpit display graphics using installed art
  and live simulator values. The A330 FCU now uses the actual glyph atlases;
  its PFD/ND/EWD/SD graphics are still custom drawings.
- [ ] Extend X-Plane texture coverage across the remaining fleet and remove
  prior surface maps from every successful texture replacement. Non-A333
  Airbus exteriors currently still use procedural paint.

Core implementation is present in the working tree. See
[CURRENT-STATE.md](../CURRENT-STATE.md) for current checks and the material
replacement correction. For comparisons, keep the installed X-Plane originals
untouched and use local same-origin `/xp/` streaming. The installed Airbus
cockpit is the A330-300. Other Airbus variants use its fitted deck and must not
be presented as exact cockpit models.
