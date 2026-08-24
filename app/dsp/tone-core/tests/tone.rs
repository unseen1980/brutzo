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
        drive: 12.0,
        tone: 1.0,
        level: 1.0,
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
        drive: 1.0,
        tone: 0.7,
        level: 0.8,
    });
    let mut driven = ToneProcessor::new(SAMPLE_RATE);
    driven.set_params(ToneParams {
        drive: 9.0,
        tone: 0.7,
        level: 0.8,
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
        drive: 5.0,
        tone: 0.4,
        level: 0.7,
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
