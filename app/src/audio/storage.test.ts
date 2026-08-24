import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { deleteTake, getTake, listTakes, loadProfile, saveTake, type CalibrationProfile } from './storage'
import { DEFAULT_FX_PARAMS } from './fx'
import { DEFAULT_TONE_PRESET } from './tone'

function take() {
  return {
    id: 'take-1',
    name: 'Take 1',
    createdAt: 1,
    durationMs: 100,
    sampleRate: 48_000,
    preset: 'clean' as const,
    tone: DEFAULT_TONE_PRESET,
    fx: DEFAULT_FX_PARAMS,
    latencyMs: null,
    deviceLabel: 'USB',
    wav: new Blob(['wav'], { type: 'audio/wav' }),
  }
}

describe('take persistence failure recovery', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('aborts and removes a partial OPFS file when writing fails', async () => {
    const abort = vi.fn(async () => undefined)
    const removeEntry = vi.fn(async () => undefined)
    const directory = {
      getFileHandle: vi.fn(async () => ({
        createWritable: vi.fn(async () => ({
          write: vi.fn(async () => { throw new Error('disk full') }),
          close: vi.fn(async () => undefined),
          abort,
        })),
      })),
      removeEntry,
    }
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn(async () => ({
          getDirectoryHandle: vi.fn(async () => directory),
        })),
      },
    })

    await expect(saveTake(take())).rejects.toThrow('disk full')
    expect(abort).toHaveBeenCalled()
    expect(removeEntry).toHaveBeenCalledWith('take-1.wav')
  })

  it('removes the completed OPFS file when the metadata upgrade is blocked', async () => {
    const removeEntry = vi.fn(async () => undefined)
    const directory = {
      getFileHandle: vi.fn(async () => ({
        createWritable: vi.fn(async () => ({
          write: vi.fn(async () => undefined),
          close: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
        })),
      })),
      removeEntry,
    }
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn(async () => ({
          getDirectoryHandle: vi.fn(async () => directory),
        })),
      },
    })
    const request: Record<string, (() => void) | undefined> = {}
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        queueMicrotask(() => request.onblocked?.())
        return request
      }),
    })

    await expect(saveTake(take())).rejects.toThrow('Close other Brutzo tabs')
    expect(removeEntry).toHaveBeenCalledWith('take-1.wav')
  })
})

describe('IndexedDB v2 migration and take CRUD', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves a v1 calibration and creates the take store', async () => {
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    const profile = calibrationProfile()
    await seedVersionOne(factory, profile)

    await expect(loadProfile()).resolves.toEqual(profile)
    const db = await openDatabase(factory, 2)
    expect([...db.objectStoreNames]).toEqual(['kv', 'takes'])
    db.close()
  })

  it('round-trips take metadata and OPFS audio through save/list/get/delete', async () => {
    const factory = new IDBFactory()
    const files = new Map<string, Blob>()
    vi.stubGlobal('indexedDB', factory)
    vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn(async () => opfsRoot(files)) } })

    const stored = take()
    await saveTake(stored)
    const listed = await listTakes()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: stored.id, name: stored.name, durationMs: stored.durationMs })
    expect(await listed[0].wav.text()).toBe('wav')
    const loaded = await getTake(stored.id)
    expect(loaded).toMatchObject({ id: stored.id, deviceLabel: 'USB' })
    expect(await loaded!.wav.text()).toBe('wav')

    await deleteTake(stored.id)
    await expect(listTakes()).resolves.toEqual([])
    await expect(getTake(stored.id)).resolves.toBeNull()
    expect(files.size).toBe(0)
  })
})

function calibrationProfile(): CalibrationProfile {
  return {
    id: 'calibration',
    version: 1,
    deviceId: 'usb-1',
    deviceLabel: 'USB',
    demoMode: false,
    channel: 0,
    sampleRate: 48_000,
    baseLatencyMs: 4,
    outputLatencyMs: 10,
    roundTripMs: 14,
    processingVerified: true,
    processingProblems: [],
    humHz: null,
    clippingSeen: false,
    inputLevelDb: -12,
    timingOffsetMs: 5,
    timingSpreadMs: 3,
    updatedAt: 1,
  }
}

async function seedVersionOne(factory: IDBFactory, profile: CalibrationProfile): Promise<void> {
  const request = factory.open('brutzo', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('kv')
  const db = await requestResult(request)
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('kv', 'readwrite')
    transaction.objectStore('kv').put(profile, 'calibration')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  db.close()
}

async function openDatabase(factory: IDBFactory, version: number): Promise<IDBDatabase> {
  return requestResult(factory.open('brutzo', version))
}

function requestResult(request: IDBOpenDBRequest): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function opfsRoot(files: Map<string, Blob>) {
  const directory = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError')
      return {
        async createWritable() {
          let pending: Blob | null = null
          return {
            async write(value: Blob) { pending = value },
            async close() {
              if (pending) files.set(name, pending)
            },
            async abort() { pending = null },
          }
        },
        async getFile() {
          const file = files.get(name)
          if (!file) throw new DOMException('Missing', 'NotFoundError')
          return file
        },
      }
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new DOMException('Missing', 'NotFoundError')
    },
  }
  return {
    async getDirectoryHandle() { return directory },
  }
}
