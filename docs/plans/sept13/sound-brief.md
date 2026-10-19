# Stage10 — aircraft sound quality

Latest explicit usergoal: make the sound amazing. Finish earlierstages, preserve
verified TCAS/GPWS clips, localspokenATC/PTT, fullcontrols/surfacebehavior. This
is a substantive audioqualitypass, not just loudermix or a renamedfeature.

Currentsrc/audio/engine-sound.ts is a basic WebAudio mono graph: samefour-cylinder
saw/square tones on everypiston; sharednoise forwind/rumble/jetroar, onesinefanwhine;
fixed620Hzsquarestallhorn; touchdownevent fixedsine70→35Hz. No view/distance,
aircraftcylinder/bladecount/enginecount distinctions, gear/flap/rollingtexture,
start/shutdown/spooltransient/reverse acoustics, or shutdown/dispose method.
SoundState carriesRPM,power,IAS,GS,ground,stall,engineRunning,jet,N1 only. Main
providescurrentphysics, so extendwithactualstate andactivevisual/cameraprofile.

Design aircraft-familyvoices forpiston/rotaryvintage/turboprop/turbofan/turbojet/
unpoweredglider as supportedbyrosteractualparameters. Use layered deterministic
noise/harmonic/impulse or appropriately licensedoriginalsamples; no proprietary
XPlaneaudio copied. Blade/cylinder/enginecounts fromactualprofileortransparent
familyapproximation, neverclaim exactrecording. Smoothly blendload/RPM/N1,
spool/start/shutdown/reverse, propwash and IAS-drivenwind. Gear/flapmechanism
sounds follow actualmotion andstopwhenmotionstops; groundrolltexture follows
surface/speed, touchdown intensity followsactualsink ratherthanalllandingssame.
Meaningful smallcockpitcontrols clicks are okay, avoidincessantnoise.

Cockpitvsoutside shouldsounddifferent: cabinfilter/attenuation, stereo engine
placementwherephysicalgeometrypermits, exterior distance attenuation and bounded
Dopplerrelativevelocity (cameramotions/transitionsmustnotpitchpop). Sensiblebus
levels/headroom/softlimiting, usermaster/engine/wind/radiowarninglevels accessible
withoutmaking criticalwarnings accidentallysilent throughengineprofile changes.
Preserve Qmutepreference, captureecho-prevention, pause/respawn lifecycle and no
perframeunboundedAudioParamautomation/nodecreation. Usergesture unlock works,
unsupported/suspendedcontext displaysusefulstate, dispose allsources/nodes/
one-shots/contexts. Avoidfalse touchdown onrespawn. No hiddenmicrophoneuse.

Root owns browserQA. Add audioinspection controls/scenarios forrepresentative
piston,turboprop,smalljet,widebody,glider, idle→takeoff→cruise→reverse→shutdown,
cockpit/exteriorview. Realmedia/WebAudiostatechecks plus meaningfultests for
finiteboundedparameters, family differences, smoothtransitions, eventgates,
resourcecleanup/reset. Staticofflinewaveform/spectralartifact can supportaudio
qualitybutactualhearingrequiresuser; don'tclaim measured10x/perfection.
Readcurrentvoice-report andmainintegrationafterStage4, notstaleinitialfunctions.
Report sound-report.md with changes,testevidence, remainingapproximations;
independentreview andfinalfullvalidationafterthislaststage. Nocommits/deployment.

Sept18 USER UPDATE (supersedes earlier no-copy/reference-only restrictions):
User explicitly requests installed X-Plane graphics and authored animations
(rudder, ailerons, flaps, slats), original aircraft and ATC sound integration,
and traffic using installed737graphics with777onlyif actualassetsavailable.
See implementation.md Sept18 scope update. Keep source assets untouched, imports
local, no publishing. Investigate supported formats and verify actual playback/
motion; do not substitute synthetic sound and call it imported. No777ACF exists
in the current installed Aircraft tree. All20aircraft have FMOD.bank/.sndfiles.
