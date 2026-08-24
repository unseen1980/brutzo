# Phase 1 Tone Completion Design

**Status:** Approved by the user's 2026-08-24 instruction to continue the supplied Phase 1 scope.

## Scope

Complete Phase 1 without pulling Phase 2 systems forward. The shipped result contains:

- a safe, deterministic amp/cab path with clean, crunch, and lead voicings;
- opt-in gate, slap delay, and ambience controls with a hard output mute;
- an honest latency panel that separates browser estimates from saved calibration data;
- processed-output WAV recording, local take persistence, playback, download, and metadata;
- explicit secure-context, device, permission, monitoring, and recording states;
- build, unit, Rust DSP, and browser/manual verification hooks.

The Phase 1 exit criterion remains hardware-dependent: the software can expose the values and workflow, but only the human reference-rig test can confirm first-good-sound time and measured end-to-end latency.

## Considered architectures

### 1. All Rust/WASM

Put amp, cabinet, gate, delay, ambience, and recording inside one Rust processor. This maximizes determinism but makes browser routing, effect bypass, and recording lifecycle more complex than the product needs now.

### 2. All native Web Audio

Build the entire chain from Web Audio nodes. This is fast to iterate but weakens the current Rust core and makes the most important tone behavior harder to exercise deterministically outside a browser.

### 3. Hybrid (selected)

Keep safety-critical and voicing DSP in Rust/WASM, use native Web Audio nodes for time-based effects, and use a small AudioWorklet recorder tap for PCM capture. This preserves the existing architecture, avoids dependencies, and keeps every source on the same `AudioGraph` path.

## Audio architecture

```text
live input or harness WAV
  -> AudioGraph input bus
  -> channel selection
  -> ToneMonitor
     -> Rust/WASM: input trim -> 70 Hz HPF -> gate -> amp drive
                  -> post tone/EQ -> cabinet voicing -> compressor -> output trim
     -> native Web Audio: dry/slap mix -> dry/ambience mix
     -> master safety gain
        -> destination
        -> recorder worklet tap -> silent sink (keeps the tap pulled)
```

The Rust processor remains allocation-free per sample. Parameter updates are normalized on the UI side and clamped again in Rust. Output mute uses a short gain ramp to avoid clicks. Delay and ambience use bounded native nodes and explicit wet gains; bypass means a wet gain of zero, not graph reconstruction.

The initial cabinet is an original deterministic Brutzo cabinet voicing, not a third-party measured IR. The implementation retains a stable cabinet control boundary so a measured, licensed IR can replace it later without changing the screen or recorder.

## Parameters and presets

The stable tone ABI contains input trim, drive, tone, cabinet character, and output level. Gate and compression parameters are part of the FX state. Clean, crunch, and lead presets set the complete tone state and remain measurably distinct in Rust tests.

Time-based FX state contains:

- gate enabled and threshold;
- slap enabled, delay time, and mix;
- ambience enabled and mix;
- master muted.

Every numeric value is finite and clamped before it reaches an audio node.

## Latency model

The UI must not label `AudioContext.baseLatency + outputLatency` as a measured round trip. It displays three distinct sources when available:

1. current browser path estimate;
2. saved setup-profile estimate, including the device name and timestamp;
3. setup timing offset, which is player/calibration timing and not audio round-trip latency.

The panel grades the current estimate against the 30 ms Phase 1 target and gives a hard wired-headphones warning when output latency or device labels suggest Bluetooth. The last successful browser estimate is persisted locally for the next visit.

## Recording and persistence

Recording is available only while monitoring is active. A recorder AudioWorklet copies the final processed mono signal into transferable PCM chunks. Stopping a take encodes 16-bit PCM WAV in the browser.

Each take stores:

- generated id and user-editable name;
- creation timestamp and duration;
- sample rate;
- selected tone preset and normalized tone/FX parameters;
- current latency estimate;
- calibrated device label.

Metadata and WAV blobs use a dedicated IndexedDB `takes` store. The UI lists newest first and supports local playback, WAV download, and deletion. Recordings never leave the device.

## UI and failure handling

The existing design tokens remain binding. The Tone screen is reorganized into focused cards: safety/status, tone controls, FX, latency, recorder, and signal path.

Before starting, the screen checks secure-context and media-device availability. Browser errors are mapped to actionable messages for permission denied, missing device, device busy/unreadable, and unsupported APIs. Start/stop actions are idempotent; duplicate monitoring and duplicate recording actions are rejected. Unmount always mutes and disconnects the graph.

## Testing

- Rust tests: silence, bounded output, NaN safety, deterministic reset, gate behavior, and preset separation.
- TypeScript tests: tone/FX normalization, latency presentation/grade, WAV headers and sample encoding, take metadata, and deployment artifact coverage.
- Build verification: WASM/worklet resources and root logo remain present.
- Browser smoke: route renders, controls respond, no console errors, live logo renders.
- Human hardware checklist: Katana/other reference rig monitoring, audible preset/FX separation, latency, feedback safety, recording/playback/download, unplug and permission cases.

## Explicit non-goals

- measured/licensed third-party cabinet IRs;
- cloud recording or sync;
- auth/accounts;
- lessons, scoring, Ghost correction, or Phase 2+ data models;
- claiming the 30 ms reference-rig exit criterion without a physical loopback/hardware run.

