/**
 * Metronome click scheduling for the strum-along timing calibration.
 * Clicks are scheduled up-front on the AudioContext clock, so the "expected"
 * beat times are exact; the wizard pairs them with detected onsets.
 */
export class Metronome {
  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode = ctx.destination,
  ) {}

  /**
   * Schedules `count` clicks at `bpm` starting at `startTime` (context time).
   * Returns the scheduled click times, in order.
   */
  scheduleClicks(count: number, bpm: number, startTime: number): number[] {
    const period = 60 / bpm
    const times: number[] = []
    for (let i = 0; i < count; i++) {
      const t = startTime + i * period
      this.click(t)
      times.push(t)
    }
    return times
  }

  private click(t: number): void {
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 1100
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    osc.connect(gain)
    gain.connect(this.destination)
    osc.start(t)
    osc.stop(t + 0.1)
  }
}
