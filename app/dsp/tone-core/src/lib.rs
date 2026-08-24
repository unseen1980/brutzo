#![deny(unsafe_op_in_unsafe_fn)]

use std::cell::UnsafeCell;

#[derive(Clone, Copy, Debug)]
pub struct ToneParams {
    pub drive: f32,
    pub tone: f32,
    pub level: f32,
}

impl Default for ToneParams {
    fn default() -> Self {
        Self {
            drive: 3.0,
            tone: 0.65,
            level: 0.7,
        }
    }
}

/// Allocation-free mono guitar tone processor for the AudioWorklet render thread.
pub struct ToneProcessor {
    sample_rate: f32,
    params: ToneParams,
    hpf_alpha: f32,
    tone_alpha: f32,
    cab_alpha: f32,
    hpf_previous_input: f32,
    hpf_previous_output: f32,
    tone_state: f32,
    cab_state: f32,
}

impl ToneProcessor {
    pub fn new(sample_rate: f32) -> Self {
        let sample_rate = sample_rate.clamp(8_000.0, 192_000.0);
        let params = ToneParams::default();
        Self {
            sample_rate,
            params,
            hpf_alpha: high_pass_alpha(70.0, sample_rate),
            tone_alpha: one_pole_alpha(tone_cutoff(params.tone), sample_rate),
            cab_alpha: one_pole_alpha(5_200.0, sample_rate),
            hpf_previous_input: 0.0,
            hpf_previous_output: 0.0,
            tone_state: 0.0,
            cab_state: 0.0,
        }
    }

    pub fn set_params(&mut self, params: ToneParams) {
        self.params = ToneParams {
            drive: params.drive.clamp(1.0, 12.0),
            tone: params.tone.clamp(0.0, 1.0),
            level: params.level.clamp(0.0, 1.0),
        };
        self.tone_alpha = one_pole_alpha(tone_cutoff(self.params.tone), self.sample_rate);
    }

    pub fn reset(&mut self) {
        self.hpf_previous_input = 0.0;
        self.hpf_previous_output = 0.0;
        self.tone_state = 0.0;
        self.cab_state = 0.0;
    }

    #[inline]
    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !input.is_finite() {
            return 0.0;
        }

        // 70 Hz one-pole high-pass removes DC and subsonic handling noise.
        let high_passed =
            self.hpf_alpha * (self.hpf_previous_output + input - self.hpf_previous_input);
        self.hpf_previous_input = input;
        self.hpf_previous_output = high_passed;

        // Normalized tanh keeps perceived level useful as drive rises.
        let drive = self.params.drive;
        let driven = (high_passed * drive).tanh() / drive.tanh();

        self.tone_state += self.tone_alpha * (driven - self.tone_state);

        // A fixed 5.2 kHz stage is the initial cab roll-off. A measured IR
        // replaces this stage later in Phase 1 without changing the ABI.
        self.cab_state += self.cab_alpha * (self.tone_state - self.cab_state);

        (self.cab_state * self.params.level).clamp(-1.0, 1.0)
    }
}

#[inline]
fn tone_cutoff(tone: f32) -> f32 {
    1_200.0 + tone * 5_800.0
}

#[inline]
fn high_pass_alpha(cutoff: f32, sample_rate: f32) -> f32 {
    let dt = 1.0 / sample_rate;
    let rc = 1.0 / (std::f32::consts::TAU * cutoff);
    rc / (rc + dt)
}

#[inline]
fn one_pole_alpha(cutoff: f32, sample_rate: f32) -> f32 {
    1.0 - (-std::f32::consts::TAU * cutoff / sample_rate).exp()
}

/// The WebAssembly instance is owned by one AudioWorklet render thread.
/// UnsafeCell avoids a lock in the hard real-time path; sharing an instance
/// between threads would violate this ABI's contract.
struct WorkletState(UnsafeCell<Option<ToneProcessor>>);
unsafe impl Sync for WorkletState {}

static WORKLET_STATE: WorkletState = WorkletState(UnsafeCell::new(None));

#[unsafe(no_mangle)]
pub extern "C" fn tone_init(sample_rate: f32) {
    // SAFETY: one WASM instance is accessed only by its owning render thread.
    unsafe { *WORKLET_STATE.0.get() = Some(ToneProcessor::new(sample_rate)) };
}

#[unsafe(no_mangle)]
pub extern "C" fn tone_set_params(drive: f32, tone: f32, level: f32) {
    // SAFETY: see `tone_init`; no other thread can access this WASM instance.
    if let Some(processor) = unsafe { &mut *WORKLET_STATE.0.get() } {
        processor.set_params(ToneParams { drive, tone, level });
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn tone_reset() {
    // SAFETY: see `tone_init`; no other thread can access this WASM instance.
    if let Some(processor) = unsafe { &mut *WORKLET_STATE.0.get() } {
        processor.reset();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn tone_process_sample(input: f32) -> f32 {
    // SAFETY: see `tone_init`; no other thread can access this WASM instance.
    unsafe { &mut *WORKLET_STATE.0.get() }
        .as_mut()
        .map_or(0.0, |processor| processor.process_sample(input))
}
