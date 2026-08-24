/**
 * IndexedDB persistence — Phase 0 storage layer (CLAUDE.md: "calibration
 * profile + settings in IndexedDB. No cloud, no auth").
 *
 * One tiny key-value store keeps this boring: `kv` maps string ids to objects.
 * The calibration profile lives under id 'calibration'.
 */

import type { SavedLatencyMeasurement } from './latency'
import { sortTakesNewestFirst, takeFileName, type StoredTake, type TakeMetadata } from './recorder'

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
  /** Legacy field name: browser-reported output-path estimate, not a measured hardware RTT. */
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
const DB_VERSION = 2
const STORE = 'kv'
const TAKES_STORE = 'takes'
const PROFILE_KEY = 'calibration'
const LATENCY_KEY = 'tone-latency'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      if (!db.objectStoreNames.contains(TAKES_STORE)) db.createObjectStore(TAKES_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      if (settled) {
        req.result.close()
        return
      }
      settled = true
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onblocked = () => fail(new Error('Local database upgrade is blocked. Close other Brutzo tabs, then reload.'))
    req.onerror = () => fail(req.error ?? new Error('IndexedDB open failed'))
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
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write was aborted'))
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
      let value: T | null = null
      req.onsuccess = () => {
        value = (req.result as T | undefined) ?? null
      }
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read was aborted'))
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

export async function saveLatencyMeasurement(measurement: SavedLatencyMeasurement): Promise<void> {
  await put(LATENCY_KEY, measurement)
}

export async function loadLatencyMeasurement(): Promise<SavedLatencyMeasurement | null> {
  return get<SavedLatencyMeasurement>(LATENCY_KEY)
}

export async function saveTake(take: StoredTake): Promise<void> {
  const fileName = takeFileName(take.id)
  let fileWritten = false
  let db: IDBDatabase | null = null
  try {
    await writeTakeWav(fileName, take.wav)
    fileWritten = true
    db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(TAKES_STORE, 'readwrite')
      const { wav: _wav, ...metadata } = take
      tx.objectStore(TAKES_STORE).put({ ...metadata, fileName })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Take write failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Take write was aborted'))
    })
  } catch (error) {
    if (fileWritten) await deleteTakeWav(fileName).catch(() => undefined)
    throw error
  } finally {
    db?.close()
  }
}

export async function listTakes(): Promise<StoredTake[]> {
  const db = await openDb()
  let records: Array<TakeMetadata & { fileName: string }>
  try {
    records = await new Promise<Array<TakeMetadata & { fileName: string }>>((resolve, reject) => {
      const tx = db.transaction(TAKES_STORE, 'readonly')
      const req = tx.objectStore(TAKES_STORE).getAll()
      let value: Array<TakeMetadata & { fileName: string }> = []
      req.onsuccess = () => {
        value = req.result as Array<TakeMetadata & { fileName: string }>
      }
      req.onerror = () => reject(req.error ?? new Error('Take list failed'))
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => reject(tx.error ?? new Error('Take list failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Take list was aborted'))
    })
  } finally {
    db.close()
  }
  const takes: StoredTake[] = []
  for (const { fileName, ...metadata } of records) {
    try {
      takes.push({ ...metadata, wav: await readTakeWav(fileName) })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        await deleteTakeMetadata(metadata.id)
      } else {
        throw error
      }
    }
  }
  return sortTakesNewestFirst(takes)
}

export async function getTake(id: string): Promise<StoredTake | null> {
  const db = await openDb()
  let record: (TakeMetadata & { fileName: string }) | null
  try {
    record = await new Promise<(TakeMetadata & { fileName: string }) | null>((resolve, reject) => {
      const tx = db.transaction(TAKES_STORE, 'readonly')
      const req = tx.objectStore(TAKES_STORE).get(id)
      let value: (TakeMetadata & { fileName: string }) | null = null
      req.onsuccess = () => {
        value = (req.result as TakeMetadata & { fileName: string } | undefined) ?? null
      }
      req.onerror = () => reject(req.error ?? new Error('Take read failed'))
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => reject(tx.error ?? new Error('Take read failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Take read was aborted'))
    })
  } finally {
    db.close()
  }
  if (!record) return null
  const { fileName, ...metadata } = record
  try {
    return { ...metadata, wav: await readTakeWav(fileName) }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      await deleteTakeMetadata(id)
      return null
    }
    throw error
  }
}

export async function deleteTake(id: string): Promise<void> {
  const db = await openDb()
  try {
    const fileName = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(TAKES_STORE, 'readonly')
      const req = tx.objectStore(TAKES_STORE).get(id)
      let value: string | null = null
      req.onsuccess = () => {
        value = (req.result as { fileName?: string } | undefined)?.fileName ?? null
      }
      req.onerror = () => reject(req.error ?? new Error('Take lookup failed'))
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => reject(tx.error ?? new Error('Take lookup failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Take lookup was aborted'))
    })
    if (fileName) {
      try {
        await deleteTakeWav(fileName)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
      }
    }
  } finally {
    db.close()
  }
  await deleteTakeMetadata(id)
}

async function deleteTakeMetadata(id: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TAKES_STORE, 'readwrite')
      tx.objectStore(TAKES_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Take delete failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Take delete was aborted'))
    })
  } finally {
    db.close()
  }
}

async function takesDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error('Local recording storage is unavailable. Use current Chrome or Edge over https://.')
  }
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('takes', { create: true })
}

async function writeTakeWav(fileName: string, wav: Blob): Promise<void> {
  const directory = await takesDirectory()
  let writable: FileSystemWritableFileStream | null = null
  try {
    const handle = await directory.getFileHandle(fileName, { create: true })
    writable = await handle.createWritable()
    await writable.write(wav)
    await writable.close()
  } catch (error) {
    await writable?.abort(error).catch(() => undefined)
    await directory.removeEntry(fileName).catch(() => undefined)
    throw error
  }
}

async function readTakeWav(fileName: string): Promise<Blob> {
  const directory = await takesDirectory()
  const handle = await directory.getFileHandle(fileName)
  return handle.getFile()
}

async function deleteTakeWav(fileName: string): Promise<void> {
  const directory = await takesDirectory()
  await directory.removeEntry(fileName)
}

export async function clearProfile(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(PROFILE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete was aborted'))
    })
  } finally {
    db.close()
  }
}

/**
 * Ask the browser not to evict the calibration profile and local recordings.
 * Returns true if granted.
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
