/**
 * Safe microphone capture & WebView-friendly error diagnostics for TwinMind AI.
 */

const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export function resolveSupportedAudioMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): string | undefined {
  const check =
    isTypeSupported ??
    (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? (mime: string) => MediaRecorder.isTypeSupported(mime)
      : undefined);

  if (!check) return undefined;
  for (const candidate of PREFERRED_AUDIO_MIME_TYPES) {
    try {
      if (check(candidate)) return candidate;
    } catch {
      // Ignore probe error and try next candidate
    }
  }
  return undefined;
}

export function createSafeAudioRecorder(stream: MediaStream): {
  recorder: MediaRecorder;
  mimeType: string;
} {
  const supported = resolveSupportedAudioMimeType();
  const recorder = supported
    ? new MediaRecorder(stream, { mimeType: supported })
    : new MediaRecorder(stream);
  return {
    recorder,
    mimeType: recorder.mimeType || supported || 'audio/webm',
  };
}

export function formatMicrophoneError(
  err: unknown,
  env?: { isSecureContext?: boolean; hasGetUserMedia?: boolean },
): string {
  const name =
    err && typeof err === 'object' && 'name' in err && typeof (err as { name?: unknown }).name === 'string'
      ? (err as { name: string }).name
      : '';
  const message = err instanceof Error ? err.message : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone permission was denied. Allow Microphone access in Android Settings > Apps > TwinMind AI (and enable Microphone in AppMint).';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No working microphone was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Your microphone is currently in use by another app or call. Close other audio apps and try again.';
    case 'SecurityError':
      return 'Microphone access was blocked by WebView security policy. Ensure HTTPS and Android RECORD_AUDIO permission are enabled.';
    case 'NotSupportedError':
      return 'This WebView does not support the selected audio recording format.';
  }

  const secure =
    env?.isSecureContext ?? (typeof window !== 'undefined' ? window.isSecureContext : true);
  if (!secure) {
    return 'Microphone capture requires an HTTPS connection. Open TwinMind over HTTPS.';
  }

  const hasGetUserMedia =
    env?.hasGetUserMedia ??
    (typeof navigator !== 'undefined' ? Boolean(navigator.mediaDevices?.getUserMedia) : true);
  if (!hasGetUserMedia) {
    return 'This browser or WebView does not expose microphone recording (getUserMedia unavailable). Check AppMint WebView microphone settings.';
  }

  return message
    ? `Could not access microphone: ${message}`
    : 'Could not access microphone. Check Android App and WebView microphone permissions.';
}
