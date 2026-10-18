import assert from 'node:assert/strict';
import test from 'node:test';
import {
  trimSilenceAndArtifactNoise,
  pcmToWav,
} from '../server/services/audioGenerationService.ts';

/**
 * Helper to construct synthetic 16-bit PCM buffers for testing.
 * @param sampleCount Number of 16-bit samples
 * @param amplitude Function or constant amplitude value (-32768 to 32767)
 */
function createPcmBuffer(sampleCount: number, amplitude: number | ((index: number) => number)): Buffer {
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const val = typeof amplitude === 'function' ? amplitude(i) : amplitude;
    const clamped = Math.max(-32768, Math.min(32767, Math.round(val)));
    buf.writeInt16LE(clamped, i * 2);
  }
  return buf;
}

test('trimSilenceAndArtifactNoise preserves empty and very short buffers safely', () => {
  const empty = Buffer.alloc(0);
  assert.equal(trimSilenceAndArtifactNoise(empty).length, 0);

  const tiny = createPcmBuffer(10, 5000);
  assert.equal(trimSilenceAndArtifactNoise(tiny).length, tiny.length);
});

test('trimSilenceAndArtifactNoise trims trailing silence while preserving speech content', () => {
  const sampleRate = 24000;
  // 1 second of speech (loud sine wave, e.g. 10000 amplitude)
  const speechSamples = sampleRate * 1;
  const speech = createPcmBuffer(speechSamples, (i) => Math.sin((i * 440 * 2 * Math.PI) / sampleRate) * 10000);

  // 1.5 seconds of dead silence (amplitude 0)
  const silenceSamples = Math.floor(sampleRate * 1.5);
  const silence = createPcmBuffer(silenceSamples, 0);

  const combined = Buffer.concat([speech, silence]);
  assert.equal(combined.length, (speechSamples + silenceSamples) * 2);

  const trimmed = trimSilenceAndArtifactNoise(combined, {
    sampleRate,
    naturalDecayMs: 80,
    trailingSilencePadMs: 40,
  });

  // The trimmed buffer should be significantly shorter than the combined buffer,
  // trimming out most of the 1.5s of dead air.
  const trimmedSamples = trimmed.length / 2;
  assert.ok(
    trimmedSamples < speechSamples + Math.floor(sampleRate * 0.3),
    `Trimmed samples (${trimmedSamples}) should be close to speech + padding, much less than total (${speechSamples + silenceSamples})`
  );
  assert.ok(
    trimmedSamples >= speechSamples,
    `Trimmed samples (${trimmedSamples}) should preserve all original speech samples (${speechSamples})`
  );
});

test('trimSilenceAndArtifactNoise detects and removes trailing artifact bursts occurring after silence', () => {
  const sampleRate = 24000;
  // 1 second of speech
  const speechSamples = sampleRate * 1;
  const speech = createPcmBuffer(speechSamples, (i) => Math.sin((i * 440 * 2 * Math.PI) / sampleRate) * 8000);

  // 250ms of silence gap (amplitude 10 - near zero)
  const silenceSamples = Math.floor((sampleRate * 250) / 1000);
  const silenceGap = createPcmBuffer(silenceSamples, 10);

  // 100ms of high-amplitude artifact noise burst (amplitude 30000)
  const artifactSamples = Math.floor((sampleRate * 100) / 1000);
  const artifactBurst = createPcmBuffer(artifactSamples, (i) => (i % 2 === 0 ? 30000 : -30000));

  const corruptedAudio = Buffer.concat([speech, silenceGap, artifactBurst]);
  const totalSamples = corruptedAudio.length / 2;

  const cleaned = trimSilenceAndArtifactNoise(corruptedAudio, {
    sampleRate,
    trailingArtifactMaxMs: 250,
    silenceBeforeArtifactMs: 80,
    naturalDecayMs: 80,
    trailingSilencePadMs: 40,
  });

  const cleanedSamples = cleaned.length / 2;
  // Cleaned samples must not include the artifact burst
  assert.ok(
    cleanedSamples < speechSamples + silenceSamples,
    `Cleaned samples (${cleanedSamples}) must strip the artifact burst and trailing gap from corrupted total (${totalSamples})`
  );

  // The last samples in the cleaned buffer should be smoothly faded/silence, not 30000
  const lastSampleVal = Math.abs(cleaned.readInt16LE(cleaned.length - 2));
  assert.ok(lastSampleVal < 100, `Final sample amplitude (${lastSampleVal}) should be near zero, not artifact spike`);
});

test('trimSilenceAndArtifactNoise applies a smooth fade-out to zero on the cut boundary', () => {
  const sampleRate = 24000;
  const speech = createPcmBuffer(sampleRate * 1, 15000);
  const trailingSilence = createPcmBuffer(sampleRate * 1, 0);
  const input = Buffer.concat([speech, trailingSilence]);

  const output = trimSilenceAndArtifactNoise(input, {
    sampleRate,
    fadeMs: 30,
    trailingSilencePadMs: 0, // no pad to check the exact fade boundary
  });

  // Check that the last sample of the fade is near zero
  const lastVal = output.readInt16LE(output.length - 2);
  assert.ok(Math.abs(lastVal) <= 10, `Fade-out boundary sample value (${lastVal}) should be near 0`);
});

test('pcmToWav produces a valid RIFF/WAVE header and correct metadata', () => {
  const sampleRate = 24000;
  const pcm = createPcmBuffer(4800, 5000); // 200ms audio
  const wav = pcmToWav(pcm, sampleRate, 1, { cleanup: false });

  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.subarray(12, 16).toString(), 'fmt ');
  assert.equal(wav.subarray(36, 40).toString(), 'data');

  assert.equal(wav.readUInt16LE(20), 1); // AudioFormat PCM
  assert.equal(wav.readUInt16LE(22), 1); // 1 channel
  assert.equal(wav.readUInt32LE(24), sampleRate); // SampleRate
  assert.equal(wav.readUInt32LE(28), sampleRate * 2); // ByteRate
  assert.equal(wav.readUInt16LE(32), 2); // BlockAlign
  assert.equal(wav.readUInt16LE(34), 16); // BitsPerSample

  const dataSize = wav.readUInt32LE(40);
  assert.equal(dataSize, pcm.length);
  assert.equal(wav.length, 44 + pcm.length);
});
