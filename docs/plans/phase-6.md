# Phase 6 plan — ATC & AI traffic (§12, §13, §24)

Acceptance (§24): full VFR flight KPAO→KSQL with correct phraseology
end-to-end; IFR CRAFT clearance + handoffs KSFO→KLAX; AI flow visibly
landing/departing in sequence at KLAX with the player slotted in.

Largest phase of the project — built in committable slices, pure-core-first
(§4.1: everything in `src/sim/atc` + `src/sim/traffic` is three.js/DOM-free
and TDD'd headlessly; voice/UI are thin adapters).

## Slices (one commit each)

- **6a. Comms + data plumbing.** `frequencies.csv` → per-airport
  TWR/GND/ATIS/CTAF/UNICOM (`/api/frequencies.json`, parser TDD'd like
  navaids). `src/sim/atc/comms.ts`: transmission bus + transcript log +
  audibility (COM1 tuned within 5 kHz hears the freq; wrong freq = honest
  silence, §12.3).
- **6b. Towered-field VFR core.** `atis.ts` (letter + text generated from
  the live BlendedWeather; active runway chosen by wind vs runway
  headings); `ground.ts` (taxi clearance + readback check); `tower.ts`
  (strip-based state machine: hold short / line up and wait / cleared for
  takeoff / pattern entry / sequence / cleared to land / go-around).
  Pilot side is an enumerated-request API (`availableRequests(state)`) the
  UI menus render later. Headless integration test: scripted aircraft
  motion + menu transmissions through the FULL KPAO departure and KSQL
  arrival flows.
- **6c. Voice + UI adapters.** Transcript window; numbered readback menu
  (keyboard 1-9); `speechSynthesis` per-facility voices through a WebAudio
  band-pass radio filter (300–3000 Hz + noise + squelch clicks); COM1
  audio-panel gating. Browser-verified with a live KPAO flow.
- **6d. AI traffic core.** `src/sim/traffic/`: point-mass per-class
  performance (GA piston / turboprop / narrowbody), lifecycle
  gate→taxi→depart→pattern/enroute→land; deterministic schedules (hub
  airline banks + GA at small fields). Render: instanced generic models.
- **6e. Traffic ↔ ATC integration.** AI transmit on the same bus, tower
  sequences player among AI (§24: "you hear and see the flow you're
  slotted into"). CTAF self-announce at untowered fields.
- **6f. IFR + acceptance.** CRAFT clearance (route/altitude/freq/squawk),
  center handoffs by region, approach clearance; fly both §24 acceptance
  flights; PROGRESS; close.

## Conventions & risks

- Controllers are pure state machines: `handleTransmission(tx) →
  Transmission[]` and `tick(dt, aircraftViews) → Transmission[]`; sim time
  only, no wall clock. Randomness through an injected seeded RNG.
- Frequencies from real data; missing frequency = documented plausible
  fallback (122.8 CTAF), flagged in the data, never silently invented for
  a REAL towered field.
- Phraseology per AIM 4-2/4-3; text is the source of truth, the voice
  layer pronounces (runway "two eight right", altimeter "two niner niner
  two").
- Sequencing bugs are the expected escalation zone (per the master-prompt
  history) — keep tower logic small-N and legible before optimizing.
