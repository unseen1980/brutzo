/**
 * IndexedDB persistence — Phase 0 storage layer (CLAUDE.md: "calibration
 * profile + settings in IndexedDB. No cloud, no auth").
 *
 * One tiny key-value store keeps this boring: `kv` maps string ids to objects.
 * The calibration profile lives under id 'calibration'.
 */

export interface CalibrationProfile {
  id: 'calibration'
  version: 1
  /** Pinned input deviceId (null = system default, e.g. laptop mic demo mode). */
  deviceId: string | null
  deviceLabel: string
  /** True when the chosen input is a built-in laptop mic (detection-only demo mode). */
  demoMode: boolean
  /** Auto-selected live channel (0 = left, 1 = right). */
  channel: 0 | 1
  sampleRate: number
  baseLatencyMs: number | null
  outputLatencyMs: number | null
  /** baseLatency + outputLatency, the honest "measured round-trip estimate". */
  roundTripMs: number | null
  /** Did track.getSettings() confirm echoCancellation/NS/AGC are all off? */
  processingVerified: boolean
  processingProblems: string[]
  /** Mains hum detected during input check (50 or 60 Hz), null if clean. */
  humHz: number | null
  /** Any clipped frames observed during the input check. */
  clippingSeen: boolean
  /** Typical playing level observed during the check, dBFS (null if silent). */
  inputLevelDb: number | null
  /** Median strum offset vs metronome from timing calibration (ms, + = late). */
  timingOffsetMs: number | null
  /** Interquartile spread of strum offsets (ms) — timing consistency. */
  timingSpreadMs: number | null
  updatedAt: number
}

const DB_NAME = 'brutzo'
const DB_VERSION = 1
const STORE = 'kv'
const PROFILE_KEY = 'calibration'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    })
  } finally {
    db.close()
  }
}

async function get<T>(key: string): Promise<T | null> {
  const db = await openDb()
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    })
  } finally {
    db.close()
  }
}

export async function saveProfile(profile: CalibrationProfile): Promise<void> {
  await put(PROFILE_KEY, profile)
}

export async function loadProfile(): Promise<CalibrationProfile | null> {
  return get<CalibrationProfile>(PROFILE_KEY)
}

export async function clearProfile(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(PROFILE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    })
  } finally {
    db.close()
  }
}

/**
 * Ask the browser not to evict our data (recordings arrive in Phase 1, but the
 * profile should already be durable). Returns true if granted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    try {
      return await navigator.storage.persist()
    } catch {
      return false
    }
  }
  return false
}
