import { GoogleGenAI } from '@google/genai';
import { modelCatalogService } from './modelCatalogService.ts';

export interface AudioCleanupOptions {
  sampleRate?: number;
  sampleSize?: number; // bytes per sample (default 2 for 16-bit PCM)
  windowMs?: number; // analysis frame size in ms (default 20ms)
  silenceThresholdRms?: number; // RMS below this is considered silence (default 120)
  speechThresholdRms?: number; // RMS above this is considered clear speech (default 350)
  trailingArtifactMaxMs?: number; // max duration of a trailing glitch burst (default 300ms)
  silenceBeforeArtifactMs?: number; // silence gap before trailing burst to classify as artifact (default 80ms)
  naturalDecayMs?: number; // comfort decay margin after speech (default 80ms)
  fadeMs?: number; // micro fade-out duration (default 30ms)
  trailingSilencePadMs?: number; // clean silence padding at the end (default 40ms)
}

/**
 * Trims silence and artifact noise at the end of raw 16-bit PCM audio.
 *
 * Neural speech synthesis models (like Gemini TTS) frequently produce trailing
 * digital artifacts, clipping spikes, or dead silence after speech finishes.
 * This function scans the waveform backwards, discards isolated trailing artifact
 * bursts that occur after speech has ended, trims trailing dead silence, preserves
 * a natural acoustic decay margin, and applies a smooth micro fade-out to zero amplitude.
 */
export function trimSilenceAndArtifactNoise(
  pcmBuffer: Buffer,
  options: AudioCleanupOptions = {}
): Buffer {
  const sampleRate = options.sampleRate ?? 24000;
  const sampleSize = options.sampleSize ?? 2;
  const totalSamples = Math.floor(pcmBuffer.length / sampleSize);

  if (totalSamples <= 0) return pcmBuffer;

  const windowMs = options.windowMs ?? 20;
  const windowSize = Math.max(1, Math.floor((sampleRate * windowMs) / 1000));
  const numWindows = Math.floor(totalSamples / windowSize);

  if (numWindows < 2) return pcmBuffer;

  // Calculate RMS energy and peak amplitude for each analysis window
  const windowRms = new Float32Array(numWindows);
  const windowPeak = new Int16Array(numWindows);

  for (let w = 0; w < numWindows; w++) {
    let sumSq = 0;
    let peak = 0;
    const start = w * windowSize;
    const end = Math.min(totalSamples, start + windowSize);
    for (let s = start; s < end; s++) {
      const val = Math.abs(pcmBuffer.readInt16LE(s * sampleSize));
      if (val > peak) peak = val;
      sumSq += val * val;
    }
    const count = end - start;
    windowRms[w] = count > 0 ? Math.sqrt(sumSq / count) : 0;
    windowPeak[w] = peak;
  }

  const silenceThreshold = options.silenceThresholdRms ?? 120;
  const speechThreshold = options.speechThresholdRms ?? 350;
  const maxArtifactWindows = Math.max(1, Math.floor((options.trailingArtifactMaxMs ?? 300) / windowMs));
  const minSilenceBeforeArtifactWindows = Math.max(1, Math.floor((options.silenceBeforeArtifactMs ?? 80) / windowMs));

  let scanWindow = numWindows - 1;

  // Step 1: Detect and discard isolated trailing artifact bursts at the very end.
  // Neural TTS models often emit a short burst of noise after a brief silence gap.
  if (windowRms[scanWindow] > silenceThreshold) {
    let burstWindows = 0;
    let testWindow = scanWindow;

    while (testWindow >= 0 && windowRms[testWindow] > silenceThreshold && burstWindows < maxArtifactWindows) {
      burstWindows++;
      testWindow--;
    }

    let silenceGapWindows = 0;
    while (testWindow >= 0 && windowRms[testWindow] <= silenceThreshold) {
      silenceGapWindows++;
      testWindow--;
    }

    // If an isolated burst occurs after a gap of silence, it is a synthetic artifact
    if (silenceGapWindows >= minSilenceBeforeArtifactWindows && burstWindows <= maxArtifactWindows) {
      scanWindow = testWindow; // discard the trailing artifact burst and preceding silence gap
    }
  }

  // Step 2: Scan backwards to find where genuine speech ended
  let lastSpeechWindow = -1;
  while (scanWindow >= 0) {
    if (windowRms[scanWindow] > speechThreshold) {
      lastSpeechWindow = scanWindow;
      break;
    }
    scanWindow--;
  }

  // If no speech above threshold was detected, return the buffer with a gentle fade
  if (lastSpeechWindow === -1) {
    return pcmBuffer;
  }

  // Step 3: Retain a natural acoustic decay margin (e.g. 80ms) so soft consonant endings
  // like 't', 's', 'th', and natural voice decay are never clipped.
  const naturalDecayWindows = Math.ceil(((options.naturalDecayMs ?? 80) / windowMs));
  const cutWindow = Math.min(numWindows, lastSpeechWindow + 1 + naturalDecayWindows);
  const cutSample = Math.min(totalSamples, cutWindow * windowSize);

  // If the cut sample covers almost the whole buffer, don't trim prematurely
  if (cutSample >= totalSamples) {
    return pcmBuffer;
  }

  const trimmedPcm = Buffer.from(pcmBuffer.subarray(0, cutSample * sampleSize));

  // Step 4: Apply a smooth micro fade-out to zero on the trimmed boundary
  const fadeMs = options.fadeMs ?? 30;
  const fadeSamples = Math.max(1, Math.floor((sampleRate * fadeMs) / 1000));
  const fadeStartSample = Math.max(0, cutSample - fadeSamples);

  for (let s = fadeStartSample; s < cutSample; s++) {
    const progress = (s - fadeStartSample) / (cutSample - fadeStartSample || 1);
    const multiplier = 1 - progress;
    const currentVal = trimmedPcm.readInt16LE(s * sampleSize);
    trimmedPcm.writeInt16LE(Math.round(currentVal * multiplier), s * sampleSize);
  }

  // Step 5: Append clean silence padding so the browser audio player stops naturally
  const silencePadMs = options.trailingSilencePadMs ?? 40;
  const silencePadSamples = Math.floor((sampleRate * silencePadMs) / 1000);
  if (silencePadSamples > 0) {
    const silenceBuffer = Buffer.alloc(silencePadSamples * sampleSize, 0);
    return Buffer.concat([trimmedPcm, silenceBuffer]);
  }

  return trimmedPcm;
}

/**
 * Converts 16-bit PCM buffer into standard browser-playable WAV format.
 * Automatically runs silence and artifact cleanup before building the 44-byte RIFF/WAVE header.
 */
export function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  options?: { cleanup?: boolean; cleanupOptions?: AudioCleanupOptions }
): Buffer {
  const shouldCleanup = options?.cleanup ?? true;
  const finalPcm = shouldCleanup
    ? trimSilenceAndArtifactNoise(pcmBuffer, { sampleRate, ...options?.cleanupOptions })
    : pcmBuffer;

  const header = Buffer.alloc(44);
  const dataLength = finalPcm.length;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(16, 34); // BitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, finalPcm]);
}

/**
 * Text-to-Speech audio generation service with automatic artifact cleanup and WAV encoding.
 */
export class AudioGenerationService {
  /**
   * Generates clean WAV audio for the specified text using dynamic TTS model discovery.
   */
  public async generateSpeechAudio(params: {
    text: string;
    voice?: string;
    apiKey: string;
    cleanupOptions?: AudioCleanupOptions;
  }): Promise<{
    audioDataUrl: string;
    wavBuffer: Buffer;
    sampleRate: number;
    rawBytes: number;
    cleanedBytes: number;
  }> {
    const { text, voice = 'Puck', apiKey } = params;

    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/[*_#>-]/g, ' ')
      .trim();

    if (!cleanText) {
      throw new Error('TTS_TEXT_EMPTY_AFTER_CLEANING: Text is empty after formatting cleanup.');
    }

    const dynamicOutputTokens = Math.ceil(cleanText.length * 2.5);
    const model = await modelCatalogService.resolveSpecializedModel('tts', apiKey);
    const client = new GoogleGenAI({ apiKey });

    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: cleanText }] }],
      config: {
        responseModalities: ['AUDIO'],
        maxOutputTokens: dynamicOutputTokens,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    });

    const inlinePart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64Audio = inlinePart?.data;
    if (!base64Audio) {
      throw new Error('TTS_OUTPUT_UNAVAILABLE: The selected model returned no audio data.');
    }

    let sampleRate = 24000;
    if (inlinePart?.mimeType) {
      const match = inlinePart.mimeType.match(/rate=(\d+)/);
      if (match) sampleRate = parseInt(match[1], 10);
    }

    const rawPcm = Buffer.from(base64Audio, 'base64');
    const wavBuffer = pcmToWav(rawPcm, sampleRate, 1, {
      cleanup: true,
      cleanupOptions: { sampleRate, ...params.cleanupOptions },
    });

    const audioDataUrl = `data:audio/wav;base64,${wavBuffer.toString('base64')}`;

    return {
      audioDataUrl,
      wavBuffer,
      sampleRate,
      rawBytes: rawPcm.length,
      cleanedBytes: wavBuffer.length - 44,
    };
  }
}

export const audioGenerationService = new AudioGenerationService();
