// Codec sound effects: the incoming-call ring, the link opening and closing,
// and the blip of tuning through MEMORY.
//
// Each one plays a local recording from `codec-sfx/` when one is there
// (ring.mp3, open.mp3, close.mp3; git-ignored, never committed, because the
// originals are the game's audio) and falls back to a Web Audio imitation.

import { readViewerBase } from "../viewer/appBase";

type Sample = "ring" | "open" | "close";

// Where the recordings are looked for: next to the page on the standalone
// site; inside Nextcloud, under the app's own viewer/ path behind the AppAPI
// proxy (the page itself is Nextcloud's, so a relative path finds nothing).
function sampleUrl(name: Sample): string {
  const proxyBase = readViewerBase();
  return proxyBase
    ? new URL(`viewer/codec-sfx/${name}.mp3`, proxyBase).toString()
    : new URL(`codec-sfx/${name}.mp3`, document.baseURI).toString();
}
const samples = new Map<Sample, AudioBuffer>();
let loading: Promise<void> | null = null;

/** Loads whichever local recordings exist. Safe to call repeatedly. */
export function loadSamples(ctx: AudioContext): Promise<void> {
  loading ??= Promise.all(
    (["ring", "open", "close"] as const).map(async (name) => {
      const url = sampleUrl(name);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        samples.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch (e) {
        console.info(`codec: no ${name} recording at ${url}, synthesising it`, e);
      }
    }),
  ).then(() => undefined);
  return loading;
}

function play(ctx: AudioContext, name: Sample, gain = 1): number | null {
  const buffer = samples.get(name);
  if (!buffer) return null;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const level = ctx.createGain();
  level.gain.value = gain;
  src.connect(level).connect(ctx.destination);
  src.start();
  return buffer.duration;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noise(ctx: AudioContext, at: number, seconds: number, gain: number, band: number, q = 0.8) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = band;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.001, at + seconds);
  src.connect(filter).connect(env).connect(ctx.destination);
  src.start(at);
}

// The ring trills between two notes a major third apart, each with a strong
// second harmonic. Pitches, harmonic levels and timing were measured off a
// recording of the original; nothing of it is played back.
const LOW_HZ = 1180;
const HIGH_HZ = 1480;
const LOW_S = 0.042;
const HIGH_S = 0.028;
const CYCLES = 13;

function tone(ctx: AudioContext, freq: number, harmonics: number[], at: number, until: number) {
  const real = new Float32Array(harmonics.length + 1);
  const imag = Float32Array.from([0, ...harmonics]);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
  osc.frequency.value = freq;
  const gate = ctx.createGain();
  gate.gain.value = 0;
  osc.connect(gate).connect(ctx.destination);
  osc.start(at);
  osc.stop(until);
  return gate.gain;
}

/** The incoming call: the trill, then the ring dying away. Resolves when done. */
export function ring(ctx: AudioContext): Promise<void> {
  const recorded = play(ctx, "ring");
  if (recorded !== null) return new Promise((resolve) => setTimeout(resolve, recorded * 1000 - 300));
  const t0 = ctx.currentTime + 0.05;
  const end = t0 + CYCLES * (LOW_S + HIGH_S) + 1.1;
  const low = tone(ctx, LOW_HZ, [0.55, 1, 0.12, 0.3], t0, end);
  const high = tone(ctx, HIGH_HZ, [0.16, 0.7, 0.05], t0, end);
  const level = 0.05;
  const gateOn = (g: AudioParam, at: number, len: number) => {
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(level, at + 0.002);
    g.setValueAtTime(level, at + len - 0.002);
    g.linearRampToValueAtTime(0, at + len);
  };
  let t = t0;
  for (let i = 0; i < CYCLES; i++) {
    gateOn(low, t, LOW_S);
    gateOn(high, t + LOW_S, HIGH_S);
    t += LOW_S + HIGH_S;
  }
  // The tail: the low note ringing on, fading over about a second.
  low.setValueAtTime(level * 0.8, t);
  low.exponentialRampToValueAtTime(0.0005, t + 1.05);
  return new Promise((resolve) => setTimeout(resolve, (end - ctx.currentTime) * 1000 - 400));
}

/** The link opening: a squelch of noise with a quick rising chirp. */
export function connect(ctx: AudioContext) {
  if (play(ctx, "open") !== null) return;
  const t0 = ctx.currentTime + 0.01;
  noise(ctx, t0, 0.35, 0.22, 2400, 0.6);
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(600, t0);
  osc.frequency.exponentialRampToValueAtTime(2200, t0 + 0.12);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.05, t0);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  osc.connect(env).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.17);
}

/** URL of the optional background track, a local file like the effects. */
export const MUSIC_URL = "codec-sfx/music.mp3";

/** A tiny blip as the memory cursor retunes to another frequency. */
export function tuneBlip(ctx: AudioContext) {
  const at = ctx.currentTime + 0.005;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = 1320;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.025, at);
  env.gain.exponentialRampToValueAtTime(0.0005, at + 0.035);
  osc.connect(env).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.04);
}

/** Hanging up: the open sweep run backwards, falling away. */
export function hangUp(ctx: AudioContext) {
  if (play(ctx, "close") !== null) return;
  const at = ctx.currentTime + 0.01;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(2200, at);
  osc.frequency.exponentialRampToValueAtTime(300, at + 0.25);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.05, at);
  env.gain.exponentialRampToValueAtTime(0.001, at + 0.28);
  osc.connect(env).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.3);
}
