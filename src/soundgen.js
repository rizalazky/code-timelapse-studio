const fs = require("fs");

const SAMPLE_RATE = 44100;

function writeWavHeader(buffer, dataLength, sampleRate, numChannels, bitsPerSample) {
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
}

/**
 * Synthesizes a single mechanical-keyswitch "click" as a Float32Array of
 * samples in [-1, 1]. It's a short noise burst (highpass-shaped so it's
 * "clicky" rather than dull) layered with a fast-decaying tone for the
 * plastic "snap". `seed` (0-1) randomizes pitch/mix so repeated clicks
 * don't sound identical/robotic.
 */
function synthesizeClick({ sampleRate = SAMPLE_RATE, seed = Math.random() } = {}) {
  const durationSec = 0.032 + seed * 0.012; // ~32-44ms
  const n = Math.max(1, Math.floor(durationSec * sampleRate));
  const samples = new Float32Array(n);

  const tickFreq = 1700 + seed * 1100; // 1700-2800 Hz "plastic snap"
  const noiseMix = 0.5 + seed * 0.25;

  let hpState = 0; // 1-pole highpass state, keeps the noise from sounding dull/muddy
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 240) * Math.min(1, t / 0.0006); // fast attack, fast decay

    const tone = Math.sin(2 * Math.PI * tickFreq * t) * (1 - noiseMix);
    const noise = Math.random() * 2 - 1;
    const filteredNoise = noise - hpState;
    hpState = hpState * 0.85 + noise * 0.15;

    samples[i] = (tone + filteredNoise * noiseMix) * env;
  }
  return samples;
}

/**
 * Builds a full-length mono audio track (Float32Array, [-1,1]) of
 * `durationMs`, with a synthesized key click mixed in at each timestamp
 * in `tickTimestampsMs`.
 *
 * `minGapMs` throttles clicks: the typing loop can tick much faster than a
 * real typist's fingers move, so without a floor the result sounds like a
 * buzz rather than individual keystrokes.
 */
function buildTypingSoundTrack({
  durationMs,
  tickTimestampsMs,
  sampleRate = SAMPLE_RATE,
  volume = 0.5,
  minGapMs = 45,
}) {
  const totalSamples = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
  const track = new Float32Array(totalSamples);

  let lastClickMs = -Infinity;
  for (const tMs of tickTimestampsMs) {
    if (tMs - lastClickMs < minGapMs) continue;
    lastClickMs = tMs;

    const click = synthesizeClick({ sampleRate, seed: Math.random() });
    const startSample = Math.floor((tMs / 1000) * sampleRate);
    for (let i = 0; i < click.length; i++) {
      const idx = startSample + i;
      if (idx >= totalSamples) break;
      track[idx] += click[i] * volume;
    }
  }

  // soft-clip in case overlapping clicks push a sample out of range
  for (let i = 0; i < totalSamples; i++) {
    track[i] = Math.max(-1, Math.min(1, track[i]));
  }
  return track;
}

function writeMonoWav(samples, outPath, sampleRate = SAMPLE_RATE) {
  const dataLength = samples.length * 2; // 16-bit PCM
  const buffer = Buffer.alloc(44 + dataLength);
  writeWavHeader(buffer, dataLength, sampleRate, 1, 16);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), offset);
    offset += 2;
  }
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { buildTypingSoundTrack, writeMonoWav, synthesizeClick, SAMPLE_RATE };
