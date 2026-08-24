#![deny(unsafe_op_in_unsafe_fn)]

use std::cell::UnsafeCell;

const CAB_TAPS: usize = 16;
// Original short cabinet impulses. `cabinet` crossfades open -> dark without
// allocating or rebuilding state on the AudioWorklet render thread.
const CAB_OPEN: [f32; CAB_TAPS] = [
    0.66, 0.31, -0.16, 0.10, -0.07, 0.05, -0.035, 0.025, -0.018, 0.013, -0.009, 0.006, -0.004,
    0.003, -0.002, 0.001,
];
const CAB_DARK: [f32; CAB_TAPS] = [
    0.16, 0.19, 0.18, 0.15, 0.12, 0.09, 0.065, 0.045, 0.030, 0.020, 0.013, 0.008, 0.005, 0.003,
    0.002, 0.001,
];

#[derive(Clone, Copy, Debug)]
pub struct ToneParams {
    pub input_trim_db: f32,
    pub drive: f32,
    pub tone: f32,
    pub cabinet: f32,
    pub level: f32,
    pub gate_threshold_db: f32,
    pub gate_enabled: bool,
}

impl Default for ToneParams {
    fn default() -> Self {
        Self {
            input_trim_db: 0.0,
            drive: 3.0,
            tone: 0.65,
            cabinet: 0.5,
            level: 0.7,
            gate_threshold_db: -54.0,
            gate_enabled: true,
        }
    }
}

/// Allocation-free mono guitar tone processor for the AudioWorklet render thread.
pub struct ToneProcessor {
    sample_rate: f32,
    params: ToneParams,
    hpf_alpha: f32,
    tone_alpha: f32,
    input_gain: f32,
    gate_threshold: f32,
    hpf_previous_input: f32,
    hpf_previous_output: f32,
    gate_envelope: f32,
    gate_gain: f32,
    tone_state: f32,
    cab_history: [f32; CAB_TAPS],
    cab_index: usize,
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
            input_gain: db_to_gain(params.input_trim_db),
            gate_threshold: db_to_gain(params.gate_threshold_db),
            hpf_previous_input: 0.0,
            hpf_previous_output: 0.0,
            gate_envelope: 0.0,
            gate_gain: 1.0,
            tone_state: 0.0,
            cab_history: [0.0; CAB_TAPS],
            cab_index: 0,
        }
    }

    pub fn set_params(&mut self, params: ToneParams) {
        self.params = ToneParams {
            input_trim_db: finite_or(params.input_trim_db, 0.0).clamp(-18.0, 12.0),
            drive: finite_or(params.drive, 1.0).clamp(1.0, 12.0),
            tone: finite_or(params.tone, 0.5).clamp(0.0, 1.0),
            cabinet: finite_or(params.cabinet, 0.5).clamp(0.0, 1.0),
            level: finite_or(params.level, 0.0).clamp(0.0, 1.0),
            gate_threshold_db: finite_or(params.gate_threshold_db, -72.0).clamp(-72.0, -24.0),
            gate_enabled: params.gate_enabled,
        };
        self.input_gain = db_to_gain(self.params.input_trim_db);
        self.gate_threshold = db_to_gain(self.params.gate_threshold_db);
        self.tone_alpha = one_pole_alpha(tone_cutoff(self.params.tone), self.sample_rate);
    }

    pub fn reset(&mut self) {
        self.hpf_previous_input = 0.0;
        self.hpf_previous_output = 0.0;
        self.gate_envelope = 0.0;
        self.gate_gain = if self.params.gate_enabled { 0.0 } else { 1.0 };
        self.tone_state = 0.0;
        self.cab_history = [0.0; CAB_TAPS];
        self.cab_index = 0;
    }

    #[inline]
    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !input.is_finite() {
            return 0.0;
        }

        // 70 Hz one-pole high-pass removes DC and subsonic handling noise.
        let trimmed = input * self.input_gain;
        let high_passed =
            self.hpf_alpha * (self.hpf_previous_output + trimmed - self.hpf_previous_input);
        self.hpf_previous_input = trimmed;
        self.hpf_previous_output = high_passed;

        let magnitude = high_passed.abs();
        let envelope_alpha = if magnitude > self.gate_envelope {
            0.08
        } else {
            0.002
        };
        self.gate_envelope += envelope_alpha * (magnitude - self.gate_envelope);
        let gate_target = if !self.params.gate_enabled || self.gate_envelope >= self.gate_threshold
        {
            1.0
        } else {
            0.0
        };
        let gate_alpha = if gate_target > self.gate_gain {
            0.12
        } else {
            0.006
        };
        self.gate_gain += gate_alpha * (gate_target - self.gate_gain);
        let gated = high_passed * self.gate_gain;

        // Normalized tanh keeps perceived level useful as drive rises.
        let drive = self.params.drive;
        let driven = (gated * drive).tanh() / drive.tanh();

        self.tone_state += self.tone_alpha * (driven - self.tone_state);

        // Short original cabinet IR, convolved directly with a fixed ring
        // buffer. The FIR is deterministic and allocation-free per sample.
        self.cab_history[self.cab_index] = self.tone_state;
        let mut cabinet = 0.0;
        let mut history_index = self.cab_index;
        for tap in 0..CAB_TAPS {
            let coefficient = CAB_OPEN[tap] + (CAB_DARK[tap] - CAB_OPEN[tap]) * self.params.cabinet;
            cabinet += self.cab_history[history_index] * coefficient;
            history_index = if history_index == 0 {
                CAB_TAPS - 1
            } else {
                history_index - 1
            };
        }
        self.cab_index = (self.cab_index + 1) % CAB_TAPS;

        // Gentle output dynamics controls transients without a brick-wall jump.
        let compressed = cabinet / (1.0 + 0.18 * cabinet.abs());
        (compressed * self.params.level).clamp(-1.0, 1.0)
    }
}

#[inline]
fn tone_cutoff(tone: f32) -> f32 {
    1_200.0 + tone * 5_800.0
}

#[inline]
fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

#[inline]
fn db_to_gain(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
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
pub extern "C" fn tone_set_params(
    input_trim_db: f32,
    drive: f32,
    tone: f32,
    cabinet: f32,
    level: f32,
    gate_threshold_db: f32,
    gate_enabled: f32,
) {
    // SAFETY: see `tone_init`; no other thread can access this WASM instance.
    if let Some(processor) = unsafe { &mut *WORKLET_STATE.0.get() } {
        processor.set_params(ToneParams {
            input_trim_db,
            drive,
            tone,
            cabinet,
            level,
            gate_threshold_db,
            gate_enabled: gate_enabled >= 0.5,
        });
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
