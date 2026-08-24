interface AudioEnvironment {
  secure: boolean
  mediaDevices: boolean
}

export function audioErrorMessage(
  cause: unknown,
  environment: AudioEnvironment = {
    secure: true,
    mediaDevices: true,
  },
): string {
  if (!environment.secure) return 'Brutzo needs a secure context. Open it over https:// or localhost.'
  if (!environment.mediaDevices) return 'Audio input is unavailable. Use current Chrome or Edge over https://.'
  const name = cause instanceof Error ? cause.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Allow microphone access in the browser site settings, then try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No audio input matches the saved setup. Reconnect it or run setup again.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The audio input is already in use or unavailable. Close other audio apps and try again.'
  }
  if (name === 'AbortError') return 'The audio input could not start. Reconnect it and try again.'
  return cause instanceof Error ? cause.message : String(cause)
}
