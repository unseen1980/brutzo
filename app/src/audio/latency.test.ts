import { describe, expect, it } from 'vitest'
import { latencyGrade, latencySummary, type SavedLatencyMeasurement } from './latency'

describe('latency presentation', () => {
  it.each([
    [null, 'unknown'],
    [12, 'good'],
    [30, 'good'],
    [30.1, 'high'],
  ] as const)('grades %s ms as %s', (value, expected) => {
    expect(latencyGrade(value)).toBe(expected)
  })

  it('keeps current browser estimate separate from saved setup data', () => {
    const saved: SavedLatencyMeasurement = {
      id: 'tone-latency',
      version: 1,
      estimateMs: 24,
      baseMs: 4,
      outputMs: 20,
      bluetoothSuspected: false,
      deviceLabel: 'Katana USB',
      measuredAt: 123,
    }
    expect(latencySummary({
      baseMs: 5,
      outputMs: 10,
      browserEstimateMs: 15,
      bluetoothSuspected: false,
      outputLabels: [],
    }, saved)).toMatchObject({ currentMs: 15, savedMs: 24, deviceLabel: 'Katana USB', grade: 'good' })
  })

  it('prioritizes a wired-output warning over a good numeric estimate', () => {
    expect(latencySummary({
      baseMs: 4,
      outputMs: 10,
      browserEstimateMs: 14,
      bluetoothSuspected: true,
      outputLabels: ['AirPods'],
    }, null).warning).toContain('wired')
  })

  it('does not grade a legacy base-only saved value as a complete path estimate', () => {
    const saved: SavedLatencyMeasurement = {
      id: 'tone-latency',
      version: 1,
      estimateMs: 4,
      baseMs: 4,
      outputMs: null,
      bluetoothSuspected: false,
      deviceLabel: 'Unknown output',
      measuredAt: 123,
    }
    expect(latencySummary(null, saved)).toMatchObject({ currentMs: null, savedMs: null, grade: 'unknown' })
  })
})
