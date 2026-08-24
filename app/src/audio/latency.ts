import type { LatencyInfo } from './engine'

export interface SavedLatencyMeasurement {
  id: 'tone-latency'
  version: 1
  estimateMs: number | null
  baseMs: number | null
  outputMs: number | null
  bluetoothSuspected: boolean
  deviceLabel: string
  measuredAt: number
}

export type LatencyGrade = 'good' | 'high' | 'unknown'

export function latencyGrade(value: number | null): LatencyGrade {
  if (value === null || !Number.isFinite(value)) return 'unknown'
  return value <= 30 ? 'good' : 'high'
}

export function latencySummary(current: LatencyInfo | null, saved: SavedLatencyMeasurement | null) {
  const currentMs = current?.browserEstimateMs ?? null
  const savedMs = saved?.baseMs != null && saved.outputMs != null ? saved.estimateMs : null
  const bluetooth = current?.bluetoothSuspected ?? saved?.bluetoothSuspected ?? false
  return {
    currentMs,
    savedMs,
    deviceLabel: saved?.deviceLabel ?? '',
    grade: latencyGrade(currentMs),
    warning: bluetooth
      ? 'Bluetooth audio adds too much delay. Switch to wired headphones before monitoring.'
      : currentMs !== null && currentMs > 30
        ? 'This browser path is above the 30 ms target. Close audio apps and use a wired USB interface.'
        : null,
  }
}

export function savedLatency(
  info: LatencyInfo,
  deviceLabel: string,
  measuredAt = Date.now(),
): SavedLatencyMeasurement {
  return {
    id: 'tone-latency',
    version: 1,
    estimateMs: info.browserEstimateMs,
    baseMs: info.baseMs,
    outputMs: info.outputMs,
    bluetoothSuspected: info.bluetoothSuspected,
    deviceLabel,
    measuredAt,
  }
}
