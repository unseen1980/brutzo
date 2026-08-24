# Brutzo

Browser-based guitar app (blues/rock/pop, electric guitar only). The signature feature is
"the Ghost": score-aware real-time assistance that corrects pitch and completes bends while
the user plays. Full context lives in PLAN.md (local, gitignored — always read it first).

## Current phase: 1 — Tone
Phase 0 is complete. Phase 1 scope is amp/cab/FX, latency measurement, and recording.
The Ghost/correction engine remains Phase 3; accounts/Supabase remain Phase 2. Do not pull
those later-phase systems forward unless explicitly asked.

## Stack decisions (already made — don't relitigate)
- App: Vite + React + TypeScript under /app, built to static files. No backend in Phase 0.
- Audio: Web Audio API in plain TS for now. Rust→WASM comes in Phase 1+, not now.
- Marketing site: /index.html and /design/foundations.html are Claude Design exports —
  treat them as APPROVED. Never restyle them; only functional patches (e.g. waitlist wiring).
- Hosting: GitHub Pages. Marketing at /, app at /app/. Deploy via GitHub Actions.
- Storage: calibration profile + settings in IndexedDB. No cloud, no auth in Phase 0.

## Design system (binding)
/design/foundations.html is the canonical reference. Tokens: accent amber #FFB020 on
near-black stage tones (#0A0A0B, #121214, #1C1C21, #26262C), warm grays #6E6B67 #A09C96,
off-white #F2F1EE. All new UI must use these. Dark mode only.

## Audio input rules (non-negotiable, from PLAN.md §3.1/§4)
- getUserMedia with echoCancellation:false, noiseSuppression:false, autoGainControl:false.
- After opening the stream, verify with track.getSettings() that they are actually off;
  surface a fix-it warning in the UI if not.
- Pin deviceId explicitly; listen for devicechange (guitarists plug in late).
- Auto-select the live channel by comparing per-channel RMS; never blindly sum stereo.
- Detect clipping (flat-topped peaks) and mains hum (50/60 Hz + harmonics) and warn.
- Read audioContext.outputLatency; if it looks like Bluetooth, show the wired-headphones
  warning.

## Verification rules
- Every audio feature must run identically from live input AND from WAV files through the
  same node graph (this is the harness requirement). If it can't, the design is wrong.
- I (the human) am the hardware tester — Claude cannot hear the Katana. End every work
  session by giving me a numbered manual test checklist for my rig.
- Reports are not verification: cite the artifact (file:line, test count, commit SHA).

## Conventions
- Small, frequent commits with imperative messages. Never commit PLAN.md.
- Prefer boring code over clever; this codebase must stay legible to a solo founder.
- When uncertain between two approaches, ask — don't silently pick.
