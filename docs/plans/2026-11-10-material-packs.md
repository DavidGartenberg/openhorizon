# Material packs

Generate small seamless linear-data tiles for coated paint, brushed metal,
rubber, fabric, cockpit trim, asphalt, and concrete. The four channels carry
albedo, roughness, height, and a wear mask. Share textures across the fleet.

Use metre-based triplanar projection on aircraft and cockpit surfaces, and
planar projection on pavement. Preserve authored maps where they remain the
selected paint source. For Boeing variants receiving X-Plane projections,
remove procedural color, roughness and bump maps so the source chart is the sole
mapped paint. High uses one tile scale; Ultra adds a second scale and paint
clearcoat relief. Performance skips detail sampling.

Keep one graphics-panel control for Factory fresh, In service, and Weathered.
Compare identical close-up daylight and sunset views; check distant surfaces
for repetition/shimmer and verify that shading survives gear and control
movement. Check render calls and frame times in the same scene before/after.

The seven generated pack implementations, shared shader finish, quality and
wear controls are now in the working tree. Unit checks cover deterministic
generation and bounded channels. Full GPU compilation, comparison screenshots,
memory measurement and sustained performance are still pending. See
[CURRENT-STATE.md](../CURRENT-STATE.md).
