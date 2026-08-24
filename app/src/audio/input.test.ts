import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputController } from './input'

describe('InputController lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('discards a permission result that arrives after close', async () => {
    let resolveInput!: (stream: MediaStream) => void
    const stopped = vi.fn()
    const track = {
      readyState: 'live',
      label: 'USB interface',
      getSettings: () => ({}),
      stop: stopped,
      onended: null,
    } as unknown as MediaStreamTrack
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    const pendingInput = new Promise<MediaStream>((resolve) => {
      resolveInput = resolve
    })
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => pendingInput),
      },
    })

    const controller = new InputController()
    const opening = controller.open(null)
    await Promise.resolve()
    await controller.close()
    resolveInput(stream)

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(stopped).toHaveBeenCalled()
    expect(controller.isOpen).toBe(false)
  })
})
