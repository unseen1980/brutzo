use brutzo_tone_core::{ToneParams, ToneProcessor};

const SAMPLE_RATE: f32 = 48_000.0;

fn sine(freq: f32, amplitude: f32, sample: usize) -> f32 {
    (std::f32::consts::TAU * freq * sample as f32 / SAMPLE_RATE).sin() * amplitude
}

#[test]
fn silence_remains_silent_and_finite() {
    let mut tone = ToneProcessor::new(SAMPLE_RATE);
    for _ in 0..48_000 {
        let output = tone.process_sample(0.0);
        assert!(output.is_finite());
        assert_eq!(output, 0.0);
    }
}

#[test]
fn safety_high_pass_rejects_dc() {
    let mut tone = ToneProcessor::new(SAMPLE_RATE);
    let mut tail_peak = 0.0_f32;
    for sample in 0..48_000 {
        let output = tone.process_sample(0.25);
        if sample > 47_000 {
            tail_peak = tail_peak.max(output.abs());
        }
    }
    assert!(tail_peak < 0.001, "DC tail was {tail_peak}");
}

#[test]
fn overload_is_bounded() {
    let mut tone = ToneProcessor::new(SAMPLE_RATE);
    tone.set_params(ToneParams {
        input_trim_db: 12.0,
        drive: 12.0,
        tone: 1.0,
        cabinet: 1.0,
        level: 1.0,
        gate_threshold_db: -72.0,
        gate_enabled: false,
    });
    for sample in 0..48_000 {
        let output = tone.process_sample(sine(220.0, 4.0, sample));
        assert!(output.is_finite());
        assert!(output.abs() <= 1.0, "unbounded output {output}");
    }
}

#[test]
fn drive_changes_the_waveform() {
    let mut clean = ToneProcessor::new(SAMPLE_RATE);
    clean.set_params(ToneParams {
        input_trim_db: -2.0,
        drive: 1.0,
        tone: 0.7,
        cabinet: 0.3,
        level: 0.8,
        gate_threshold_db: -72.0,
        gate_enabled: false,
    });
    let mut driven = ToneProcessor::new(SAMPLE_RATE);
    driven.set_params(ToneParams {
        input_trim_db: 2.0,
        drive: 9.0,
        tone: 0.7,
        cabinet: 0.8,
        level: 0.8,
        gate_threshold_db: -72.0,
        gate_enabled: false,
    });

    let difference: f32 = (0..4_800)
        .map(|sample| {
            let input = sine(220.0, 0.3, sample);
            (clean.process_sample(input) - driven.process_sample(input)).abs()
        })
        .sum::<f32>()
        / 4_800.0;

    assert!(difference > 0.02, "drive difference was only {difference}");
}

#[test]
fn reset_makes_processing_deterministic() {
    let mut tone = ToneProcessor::new(SAMPLE_RATE);
    tone.set_params(ToneParams {
        input_trim_db: 0.0,
        drive: 5.0,
        tone: 0.4,
        cabinet: 0.5,
        level: 0.7,
        gate_threshold_db: -72.0,
        gate_enabled: false,
    });
    let first: Vec<f32> = (0..1_000)
        .map(|sample| tone.process_sample(sine(110.0, 0.4, sample)))
        .collect();
    tone.reset();
    let second: Vec<f32> = (0..1_000)
        .map(|sample| tone.process_sample(sine(110.0, 0.4, sample)))
        .collect();
    assert_eq!(first, second);
}

#[test]
fn gate_attenuates_noise_below_threshold() {
    let mut gated = ToneProcessor::new(SAMPLE_RATE);
    gated.set_params(ToneParams {
        input_trim_db: 0.0,
        drive: 2.0,
        tone: 0.6,
        cabinet: 0.5,
        level: 0.8,
        gate_threshold_db: -45.0,
        gate_enabled: true,
    });
    let mut open = ToneProcessor::new(SAMPLE_RATE);
    open.set_params(ToneParams {
        gate_enabled: false,
        ..ToneParams::default()
    });

    let gated_energy: f32 = (0..48_000)
        .map(|sample| gated.process_sample(sine(220.0, 0.001, sample)).abs())
        .sum();
    let open_energy: f32 = (0..48_000)
        .map(|sample| open.process_sample(sine(220.0, 0.001, sample)).abs())
        .sum();

    assert!(
        gated_energy < open_energy * 0.2,
        "gate ratio was {}",
        gated_energy / open_energy
    );
}

#[test]
fn non_finite_parameters_and_input_stay_safe() {
    let mut tone = ToneProcessor::new(SAMPLE_RATE);
    tone.set_params(ToneParams {
        input_trim_db: f32::NAN,
        drive: f32::INFINITY,
        tone: f32::NEG_INFINITY,
        cabinet: f32::NAN,
        level: f32::INFINITY,
        gate_threshold_db: f32::NAN,
        gate_enabled: true,
    });
    assert_eq!(tone.process_sample(f32::NAN), 0.0);
    for sample in 0..4_800 {
        let output = tone.process_sample(sine(110.0, 0.4, sample));
        assert!(output.is_finite());
        assert!(output.abs() <= 1.0);
    }
}

#[test]
fn cabinet_voicings_are_distinct() {
    let average = |cabinet: f32| {
        let mut tone = ToneProcessor::new(SAMPLE_RATE);
        tone.set_params(ToneParams {
            cabinet,
            gate_enabled: false,
            ..ToneParams::default()
        });
        (0..9_600)
            .map(|sample| tone.process_sample(sine(4_000.0, 0.3, sample)).abs())
            .sum::<f32>()
            / 9_600.0
    };
    let open = average(0.0);
    let dark = average(1.0);
    assert!(open > dark * 1.25, "cabinet contrast was {open} vs {dark}");
}
