// src/engine/sfx.js — SPEC-v8 §2: fully synthesized audio, zero asset files.
// 12 one-shots (jump, land, pickup ×3 resource classes, throw, hit, collapse,
// gate-open, era-swell, denied-buzz, menu-click) + 3 ambient beds that
// crossfade by era group (1-5 acoustic-ish / 6-11 industrial / 12-17
// electronic). WebAudio only; headless-safe (createSfx works with no
// AudioContext at all — every call becomes a silent no-op, which is also how
// the unit tests assert trigger behavior via `lastEvent`).
//
// Reduced motion does NOT mute (audio isn't motion), but the settings volume
// drives everything: vol = master * (music|sfx), music bed per-bed gain, SFX
// through one sfx bus.

const RESOURCE_CLASSES = { sustenance: 'organic', knowledge: 'crystal', coin: 'coin' };

/** Which of the 3 beds an era uses (SPEC §2 grouping). */
export function bedForEra(era) {
  if (era <= 5) return 'acoustic';
  if (era <= 11) return 'industrial';
  return 'electronic';
}

// ------------------------------------------------------------------ voices
// Each voice builds nodes on `ctx` at `when`, self-contained, returns nothing.
// All frequencies Hz, gains linear, durations seconds.

function noiseBuffer(ctx, seconds = 0.5) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 0x9e3779b9;
  for (let i = 0; i < len; i++) { // deterministic LCG so tests/boot are stable
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

function env(ctx, dest, peak, t0, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(dest);
  return g;
}

function tone(ctx, dest, { type = 'sine', f0, f1 = null, dur = 0.15, peak = 0.3, attack = 0.005, t0 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  const g = env(ctx, dest, peak, t0, attack, dur);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + attack + dur + 0.05);
  return osc;
}

function noiseHit(ctx, dest, { dur = 0.12, peak = 0.25, filter = 'lowpass', freq = 800, q = 1, t0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.1);
  const flt = ctx.createBiquadFilter();
  flt.type = filter; flt.frequency.value = freq; flt.Q.value = q;
  const g = env(ctx, dest, peak, t0, 0.004, dur);
  src.connect(flt); flt.connect(g);
  src.start(t0);
  src.stop(t0 + dur + 0.1);
}

export const VOICES = {
  jump(ctx, dest, t0) { tone(ctx, dest, { type: 'triangle', f0: 220, f1: 520, dur: 0.09, peak: 0.28, t0 }); },
  land(ctx, dest, t0) { tone(ctx, dest, { type: 'sine', f0: 140, f1: 55, dur: 0.1, peak: 0.4, t0 }); noiseHit(ctx, dest, { dur: 0.06, peak: 0.12, freq: 300, t0 }); },
  pickup_sustenance(ctx, dest, t0) { // organic: soft woody pluck
    tone(ctx, dest, { type: 'triangle', f0: 392, f1: 340, dur: 0.12, peak: 0.25, t0 });
    tone(ctx, dest, { type: 'sine', f0: 784, dur: 0.05, peak: 0.08, t0 });
  },
  pickup_knowledge(ctx, dest, t0) { // crystal: bright bell partials
    tone(ctx, dest, { type: 'sine', f0: 1046, dur: 0.3, peak: 0.18, t0 });
    tone(ctx, dest, { type: 'sine', f0: 1568, dur: 0.22, peak: 0.09, t0 });
    tone(ctx, dest, { type: 'sine', f0: 2093, dur: 0.15, peak: 0.05, t0 });
  },
  pickup_coin(ctx, dest, t0) { // metal: two-note metallic ping
    tone(ctx, dest, { type: 'square', f0: 1318, dur: 0.06, peak: 0.12, t0 });
    tone(ctx, dest, { type: 'square', f0: 1760, dur: 0.12, peak: 0.12, t0: t0 + 0.05 });
  },
  throw(ctx, dest, t0) { noiseHit(ctx, dest, { filter: 'bandpass', freq: 1200, q: 2, dur: 0.1, peak: 0.2, t0 }); },
  hit(ctx, dest, t0) { // crunch + low thump (Celeste death energy, softer)
    noiseHit(ctx, dest, { filter: 'lowpass', freq: 500, dur: 0.15, peak: 0.4, t0 });
    tone(ctx, dest, { type: 'sawtooth', f0: 110, f1: 40, dur: 0.18, peak: 0.3, t0 });
  },
  collapse(ctx, dest, t0) { // long descending rumble
    tone(ctx, dest, { type: 'sawtooth', f0: 90, f1: 28, dur: 0.9, peak: 0.45, attack: 0.02, t0 });
    noiseHit(ctx, dest, { filter: 'lowpass', freq: 220, dur: 0.8, peak: 0.3, t0 });
  },
  'gate-open'(ctx, dest, t0) { // rising fifth + airy bloom
    tone(ctx, dest, { type: 'triangle', f0: 261, dur: 0.5, peak: 0.2, attack: 0.05, t0 });
    tone(ctx, dest, { type: 'triangle', f0: 392, dur: 0.5, peak: 0.16, attack: 0.08, t0: t0 + 0.08 });
    noiseHit(ctx, dest, { filter: 'highpass', freq: 2000, dur: 0.5, peak: 0.06, t0: t0 + 0.1 });
  },
  'era-swell'(ctx, dest, t0) { // two-bar swell under the transition sequence
    for (const [f, d] of [[110, 0], [165, 0.15], [220, 0.3], [330, 0.5]]) {
      tone(ctx, dest, { type: 'sine', f0: f, dur: 0.9 - d * 0.8, peak: 0.16, attack: 0.25, t0: t0 + d });
    }
  },
  'denied-buzz'(ctx, dest, t0) { // dissonant double buzz
    tone(ctx, dest, { type: 'square', f0: 138, dur: 0.09, peak: 0.15, t0 });
    tone(ctx, dest, { type: 'square', f0: 146, dur: 0.09, peak: 0.15, t0 });
  },
  'menu-click'(ctx, dest, t0) { tone(ctx, dest, { type: 'square', f0: 880, dur: 0.03, peak: 0.12, t0 }); },
};

export const SFX_NAMES = Object.freeze(Object.keys(VOICES));

/** Resolve a pickup sound from a resource class or pool name. */
export function pickupVoice(pool) {
  const cls = RESOURCE_CLASSES[pool];
  if (cls === 'organic') return 'pickup_sustenance';
  if (cls === 'crystal') return 'pickup_knowledge';
  if (cls === 'coin') return 'pickup_coin';
  return 'pickup_sustenance';
}

// --------------------------------------------------------------- ambient beds
// Each bed is a looping drone built once, held behind its own gain node.
//   acoustic:   soft filtered-noise wind + slow triangle fifth
//   industrial: low saw drone + rhythmic 40 BPM pulse (lo-fi machinery)
//   electronic: two detuned saws through a slowly swept lowpass
function buildBed(ctx, out, kind) {
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  g.connect(out);
  const now = ctx.currentTime;
  const nodes = [];
  if (kind === 'acoustic') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 2);
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 480;
    src.connect(flt); flt.connect(g);
    src.start(now);
    nodes.push(src, flt);
    for (const f of [110, 165]) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = 0.05;
      o.connect(og); og.connect(g); o.start(now);
      nodes.push(o, og);
    }
  } else if (kind === 'industrial') {
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = 55;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 200;
    const og = ctx.createGain(); og.gain.value = 0.08;
    o.connect(flt); flt.connect(og); og.connect(g); o.start(now);
    nodes.push(o, flt, og);
    const lfo = ctx.createOscillator();
    lfo.type = 'square'; lfo.frequency.value = 40 / 60; // 40 BPM pulse
    const lg = ctx.createGain(); lg.gain.value = 0.04;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(now);
    nodes.push(lfo, lg);
  } else { // electronic
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = 82.4; o.detune.value = det;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.value = 600; flt.Q.value = 6;
      const og = ctx.createGain(); og.gain.value = 0.05;
      o.connect(flt); flt.connect(og); og.connect(g); o.start(now);
      nodes.push(o, flt, og);
      const sweep = ctx.createOscillator();
      sweep.type = 'sine'; sweep.frequency.value = 0.05;
      const sg = ctx.createGain(); sg.gain.value = 300;
      sweep.connect(sg); sg.connect(flt.frequency); sweep.start(now);
      nodes.push(sweep, sg);
    }
  }
  return { gain: g, nodes };
}

// ------------------------------------------------------------------ factory
/**
 * @param {object} deps {
 *   ctx?: AudioContext-like,          // omit → silent mode (headless/tests)
 *   getSettings?: () => ({volume?, music?, sfx?}),  // 0..1, default 0.7/0.6/0.8
 *   reducedMotion?: boolean|fn,       // never mutes; reserved for future ducking
 * }
 */
export function createSfx(deps = {}) {
  const ctx = deps.ctx || null;
  const settings = typeof deps.getSettings === 'function' ? deps.getSettings : () => ({});
  const lastEvents = []; // headless observability: [{name, at}]
  const beds = {};
  let sfxBus = null, musicBus = null, currentBed = null;

  if (ctx) {
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(ctx.destination);
    musicBus.connect(ctx.destination);
    for (const kind of ['acoustic', 'industrial', 'electronic']) beds[kind] = buildBed(ctx, musicBus, kind);
  }

  function applyVolumes() {
    if (!ctx) return;
    const s = settings() || {};
    const master = s.volume ?? 0.7;
    sfxBus.gain.setTargetAtTime(master * (s.sfx ?? 0.8), ctx.currentTime, 0.05);
    musicBus.gain.setTargetAtTime(master * (s.music ?? 0.6), ctx.currentTime, 0.5);
  }

  /** Fire a one-shot by name ('pickup' resolves via pool). No-op in silent mode. */
  function play(name, { pool = null, when = null } = {}) {
    const resolved = name === 'pickup' ? pickupVoice(pool) : name;
    lastEvents.push({ name: resolved, at: ctx ? ctx.currentTime : lastEvents.length });
    if (lastEvents.length > 64) lastEvents.shift();
    if (!ctx || !VOICES[resolved]) return false;
    applyVolumes();
    VOICES[resolved](ctx, sfxBus, when ?? ctx.currentTime);
    return true;
  }

  /** Crossfade to the bed for `era` over `fadeSec` (spec: ~1 s). Idempotent. */
  function setEra(era, fadeSec = 1.0) {
    const want = bedForEra(era);
    if (!ctx) { currentBed = want; return want; }
    if (currentBed === want) return want;
    const t = ctx.currentTime;
    for (const [kind, b] of Object.entries(beds)) {
      b.gain.gain.cancelScheduledValues(t);
      b.gain.gain.setTargetAtTime(kind === want ? 1 : 0.0001, t, fadeSec / 3);
    }
    currentBed = want;
    return want;
  }

  function stopAll() {
    if (!ctx) return;
    for (const b of Object.values(beds)) b.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
    currentBed = null;
  }

  applyVolumes();
  return {
    play, setEra, applyVolumes, stopAll,
    get silent() { return !ctx; },
    get era() { return currentBed; },
    get lastEvent() { return lastEvents[lastEvents.length - 1] || null; },
    events: lastEvents,
  };
}
