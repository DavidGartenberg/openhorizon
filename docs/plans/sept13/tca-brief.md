# Stage 6 — TCA Captain Edition bindings and calibration

Read global constraints in implementation.md and current voice-report.md for PTT
API. Own gamepad-map.ts, focused controller/calibration UI, main.ts polling/wizard
integration, input ownership as needed, tests. Preserve graphics, airports,
warnings, voice, loading; no unrelated flight dynamics replacement.

Respect measured Mac hardware facts already documented in gamepad-map.ts:
- TCA Sidestick X Copilot(044f:040f),10axes: roll0,pitch1,yaw5,slider6.
- TCA Q-Eng1&2(044f:0407),7axes: throttle0 and throttle2 axis1, IDLE=-1,TOGA=+1,
  sign+1. Earlier unverified sign flip caused runaway thrust. Never flip these
  defaults without live readings. Do not automatically bind resting buttons16+.
Official Windows diagrams are not universal browser/Mac indices.

Implement reliable two-lever binding, calibrated endpoints and idle/reverse
detent, optional CL/FLEX/TOGA detents as appropriate. Current leverWithReverse
needs raw<-1.08 to reverse (normal Gamepad range[-1,1]): replace with measured idle
position mapping; default measured idle=-1 means reverse buttons supply reverse
until calibration establishes below-idle travel. Both reverse lift buttons must
be held/released symmetrically (currently ENG2 toggles and release can stick).
Interpret both lever directions before combining for current shared engine model,
show each lever separately. No average-before-reverse direction inversion. State
existing aggregate engine limitation plainly rather than claim independent engine
physics. Keyboard reverse must still work when hardware does not own command.

Bind add-on flaps, speedbrake, parking brake and PTT via actual axis/button capture
with progress/live values (no guesses for absent add-on); retained tested known
presets autoapply on connected devices and on initial page load, not only future
gamepadconnected events. Device identity + index remap on reconnect; wrong device
must not inherit bindings. Missing/nonfinite axes must return unavailable, never
center yielding50%thrust. Input focus/blur/disconnect clear held reverse/PTT/brakes.
Restrict TCA matching so generic unrelated Thrustmaster is not treated as Airbus.
Validate saved maps/enums/finite indices/calibration with migration retaining
user-calibrated data. Wizard should not silently bind a newly connected/resting
axis or skip steps by timeout; clear instructions, retry/skip/cancel explicit.

Control panel should show connection, ENG1/ENG2 thrust and detent/reverse, flaps,
speedbrake, parking brake and transmit state. Provide guided capture for missing
functions, enough feedback for user to verify physical travel. No privileged HID
driver installation needed: use existing navigator.getGamepads. User was asked
whether hardware is currently connected; check root's answer if available.

Primary references:
https://support.thrustmaster.com/en/product/tca-quadrant-airbus-edition-en/
https://ts.thrustmaster.com/download/accessories/Manuals/TCA_Quadrant/TCA_Quadrant_Airbus_Edition_user_manual.pdf
https://support.thrustmaster.com/en/product/tca-quadrant-add-on-airbus-edition-en/
Official manual identifies physical twoaxes/reversemechanisms/detents and addon;
keep profile/browser mapping distinction. No need install Windows drivers on Mac.

Tests first: measuredpolarity,calibrationreversewithin[-1,1],asymmetriclevers,
eitherreversebuttonrelease,missingaxis/disconnect,wrongdevice/reindex,heldPTT,
addonflaps/spoilers/parkingbrake,no restingautoassignment,savedmapvalidationand
migration. Run focused controller/input/PTTtests and tsc. Root browser only.
Full report tca-report.md incl physical verification checklist; concise status.
No commits. Finish software even if hardware motion cannot be supplied by agent.

Root live browser snapshot Sept13 16:58: both devices ARE CONNECTED and exposed
after page interaction. Pad0 Sidestick X Copilot(Vendor044f Product040f): axes0–5
and7–9 near0,axis6=+1; button16 held at rest. Pad1 Q-Eng1&2(Vendor044f Product0407):
axes0=-1,1=-1,2=-1,3=0,4=0,5=-1,6=0; heldbuttons8,12,26. This confirms existing
quadrant idle polarity and resting button warning; it does NOT establish which
addon axes/switches are which without movement. Diagnostics page
/tests/browser/system-check.html exposes values read-only; use root for live UI.

User reinforced full quadrant functionality. Include complete physical-control
inventory in the mapping UI now, then Stage8 audits actual hardware coverage:
both throttle levers/reverse lifts, engine master switches1/2, ignition mode,
speedbrake lever/detents, flap lever/detents, gear lever, autobrake selector,
rudder trim left/right/reset and parking brake. Virtual detent buttons are
alternate representations of axes, not extra arbitrary actions to assign.
Manufacturer source confirms trim/gear/autobrake/ruddertrim/parkingbrake:
https://eshop.thrustmaster.com/en_us/tca-quadrant-add-on-airbus-edition.html
Add-on manual (Englishpp1–6) has2axes15buttons and physical map, not necessarily
matching Mac Gamepad indices:
https://ts.thrustmaster.com/download/accessories/Manuals/TCA_Quadrant/TCA_Quadrant_Add-On_Airbus_Edition_user_manual.pdf

Current code has no autobrake or engineMaster1/2 and no rudder-trim functions.
Implement meaningful simulator state/behavior for mapped controls instead of
label-only/no-op bindings. Start/ignition state currently piston magneto+starter
in main systemsControls; jets need appropriate engine-master behavior. Existing
parkingBrake auto-releases at throttle>.15 in main; a physical latched brake must
not be silently released and desynchronized. Rudder trim should influence actual
yaw control/surface consistently. Distinguish latching set-on/set-off controls
from edge-triggered toggles to survive reconnect and avoid held-repeat actions.

Stage4nowincludesPushToTalk.poll(source,physicalDown|null) requiringfreshphysical
release beforearm, preservedacrossreset/focusloss/disconnect/newflight. Main
physicalPttState() readsactualmappedgamepadbuttons, notInputvirtualheldstate.
Preserve this whenrewritingidentity/mappings: missingdevice=null, neverfakefalse
thatcountsasrelease. Foregroundandinputeligibilitymustholdbeforearming.
