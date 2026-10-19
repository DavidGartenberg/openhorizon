# Stage 8b procedural moving-surface audit

Scope: the four procedural factories and their existing render profiles. This is an implementation handoff, not acceptance evidence. `SurfaceState`, `main.ts`, and the native adapter are owned by the parallel native-surfaces work.

## Factory and roster coverage

| Factory | Player catalog coverage | Moving geometry today | Fixed or overlapping geometry that remains |
| --- | --- | --- | --- |
| `buildC172` (`aircraft-mesh.ts`) | Special catalog key `172` | Two inboard flap pivots; aft/down Fowler pose | The lofted `c172Wing` still contains the whole airfoil through the trailing edge. There are no ailerons or elevators. The full stabilizers remain fixed. The red rudder is a separate mesh but has no hinge or motion, and its leading region overlaps the aft edge of the full fin outline. |
| `buildCub` / `buildDetailedCub` (`cub-mesh.ts`) | Special catalog key `CUB` | None; the returned mesh has no `surfaces` callback | `cubWing` is a single closed full-chord loft. Both `ovalTail` meshes are single-piece fixed surfaces, so ailerons, elevators, rudder, and flaps are absent as distinct geometry. |
| `buildB738` (`aircraft-mesh.ts`) | Special catalog key `737` | One Fowler flap and one spoiler pivot per side; gear and reversers | Each full-chord wing remains beneath the flap and spoiler. There are no distinct ailerons, elevators, or rudder. Both stabilizers and the fin are single fixed panels. Fowler fairings are paired shapes rather than a connected rail/carriage mechanism; spoilers have no hinge brackets or actuator. |
| `buildPropAircraft` (`prop-aircraft.ts`) | Every non-jet entry in the 120-entry `ROSTER`, selected by `player-aircraft.ts`; profiles are exhaustive and throw when missing | One flap pivot per side, generic retractable gear, and a `speedBrake` pivot per side | The outboard `wingTrailingFixed` is exactly where the aileron must be split out. The stabilizer/ruddervator panels are whole and fixed. Normal/T-tail fins are whole, with a coplanar/thicker `rudderAccent` painted over the trailing region rather than a cut-out rudder. A spoiler is constructed for every profile even though the simulation parameter contract says spoilers are absent for the piston fleet and only exposes motion when `spoilerFrac` changes. |
| `buildAirliner` (`airliner-mesh.ts`) | Every jet entry in the 120-entry `ROSTER`, selected by `player-aircraft.ts`; `jetProfileFor` is exhaustive and throws when missing | One Fowler flap and one spoiler pivot per side; gear and reversers | The full-chord wing remains under both moving slabs. No distinct ailerons, elevators, or rudder exist. Fin and stabilizers are whole fixed panels. The paired canoe shapes do not form rails/support arms, and spoiler panels have no thickness-aware brackets or actuator. |

Together the three special builders plus the roster factories cover all 123 selectable player entries. Traffic LOD factories are outside this audit.

## Concrete geometry and attachment defects

1. The generic prop flap hinge is not the flap's real hinge line. The flap mesh has dihedral baked into its vertices, but its pivot is placed at one constant `y`/`z` origin and rotates about group-local X. Its inboard and outboard leading-edge endpoints therefore do not define the rotation axis. The same axis shortcut appears in the swept jet and dedicated 737 flaps: the trailing-edge locus changes fore/aft along span, yet the group rotates around unswept local X.
2. The moving flap slabs do not replace the corresponding part of the parent wing skin in C172, B738, or generic jets. Nesting a flap under a full wing can hide it at zero travel, but produces duplicated volume and cannot prove a clean slot or attachment through travel.
3. Jet flap fairings are only a fixed front blob plus an aft blob parented to the flap. No rail, carriage, or support arm joins a fixed wing mount to a moving flap mount. Translation can therefore open a visible mechanical disconnect even if the two fairing skins still appear close.
4. Every spoiler is placed on top of an uncut wing. Generic prop spoilers are unconditional and thus invent hardware for profiles whose `AircraftParams` has no spoilers. Jet/B738 spoiler boxes have no hinge brackets, panel well, or actuator, so deployment visibly floats above an intact skin.
5. C172, Cub, generic props, B738, and generic jets lack animated pitch and yaw geometry. C172's separate rudder is still a static sibling rather than a hinge child. Generic `rudderAccent` overlaps the full fin; generic `horizontalStabilizer`/`ruddervator`, jet stabilizers, and Cub tails are undivided solids.
6. Roll is represented only by spoileron mixing in the jet factories. There are no true ailerons anywhere in the four audited factories. Generic props animate neither roll nor pitch/yaw despite having a `surfaces` callback.
7. Inputs are not consistently sanitized inside these factories. Prop flaps/spoilers clamp, but C172/B738/airliner Fowler calls accept `flapFrac` directly and jet spoiler mixing accepts `roll` directly. The shared adapter should sanitize, while each rig should still treat nonfinite values as neutral to keep geometry bounded.

## Profile-evidenced exceptions to preserve

These are the only topology exceptions established by current profile data; they should be explicit rig choices rather than inferred from aircraft names.

- `BE35` alone has `tail: 'v'`. Its two existing canted `ruddervator` panels need fixed leading portions plus moving trailing portions, with pitch applied symmetrically and yaw differentially. It must not gain a conventional fin/rudder.
- `P180` alone has `pusher: true` and `tail: 't'`. The profile creates both a foreplane and an aft T-tail. Preserve both surfaces and the aft pusher clearance. The profile does not say the foreplane is the pitch control, so do not animate the canard without adding an evidenced profile field.
- `AN2` alone has `biplane: true`. Preserve both wings and interplane struts/wires. Current data does not identify which wing carries ailerons; add an explicit profile selection before splitting them rather than copying controls onto both wings.
- T-tail props are explicitly identified by `tail: 't'` (the shared Diamond, commuter, King Air, and sailplane families plus their overrides). Their horizontal-tail rig must inherit the fin-top transform instead of using a world-space hinge.
- `glider: true` is explicit for `AS21`, `DG80`, `LS8`, and `DISC`. Their current physics parameters do not establish spoilers in this renderer; do not retain the unconditional generic `speedBrake` merely because real-world sailplanes may have them.
- Jet tail placement is explicitly `tTail` or `stabilizerHeight`; engine placement is explicitly `wing`, `tail`, or `overwing`. Tail-mounted/overwing nacelles and elevated stabilizers must remain clear when elevator/rudder geometry is split. Nothing in `JetProfile` identifies spoiler-only roll, so all jets should receive ailerons unless a new explicit roll-control field is backed by source data.

## Smallest coherent implementation seam

Keep topology in profile/config data and put transform math in one procedural helper, for example `procedural-surfaces.ts`:

```ts
interface HingeLine {
  inboard: THREE.Vector3
  outboard: THREE.Vector3
}

interface HingedSurface {
  root: THREE.Object3D
  hinge: HingeLine
  setAngle(rad: number): void
  fixedMounts: readonly THREE.Object3D[]
  movingMounts: readonly THREE.Object3D[]
}

interface ProceduralSurfaceRig {
  leftAileron?: HingedSurface
  rightAileron?: HingedSurface
  elevators?: readonly HingedSurface[]
  rudder?: HingedSurface
  ruddervators?: readonly [HingedSurface, HingedSurface]
  flaps: readonly FowlerSurface[]
  spoilers: readonly SpoilerSurface[]
  apply(state: SurfaceState): void
}
```

`createHingedPlanform(parent, planform, spanRange, chordFraction, name)` should generate two non-overlapping meshes from the same stations: a fixed leading section and a moving trailing section. Build a hinge frame from the actual endpoint vector, parent the moving mesh in that frame, and rotate around its local hinge axis. This works for tapered/swept/dihedral wings, conventional and T-tail stabilizers, vertical rudders, canted V-tail surfaces, and an explicitly selected biplane wing. A vertical-planform companion can use the same endpoint-frame math for fin/rudder splits.

`createFowlerSurface` should extend that hinged surface with an explicit pose function plus rail stations. Each station needs a fixed wing mount, a carriage/moving flap mount, and a support arm whose endpoints are recomputed after transforms on every update. `createSpoilerSurface` should cut or omit the panel area from the fixed upper skin, retain finite thickness, and add two hinge brackets plus an actuator joining a fixed wing mount to a moving panel mount. The actuator should be a reusable endpoint-to-endpoint rod updated from `localToWorld`/`worldToLocal`, not a decorative child of only one side.

The profile addition can stay small:

```ts
type RollSurface = { kind: 'ailerons'; wing: 'main' | 'upper' | 'lower' }
  | { kind: 'spoilerOnly' }
type PitchSurface = { kind: 'elevator' } | { kind: 'ruddervator' }

interface SurfaceTopology {
  roll: RollSurface
  pitch: PitchSurface
  rudder: 'separate' | 'mixed'
  flaps: boolean
  spoilers: boolean
}
```

Populate defaults by existing factory family, then override only the evidenced exceptions above. In particular, set `spoilers` from `params.spoilers`, not from broad prop/jet classification. Keep the P180 foreplane fixed and leave AN2's aileron wing unresolved until profile evidence is added.

The factory callbacks then only clamp finite state and apply signs: right roll raises the right aileron and lowers the left; pull raises conventional elevators; right yaw moves the rudder trailing edge right; V-tail mixing combines pitch and yaw without changing the existing cant. Fowler and spoiler attachment objects update after surface transforms so sampled states at 0, .25, .5, .75, and 1 can measure continuity rather than merely mesh names.
