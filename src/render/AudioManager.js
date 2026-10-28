// src/render/AudioManager.js — Web Audio API wrapper (SPEC §4.3 / §6).
// Hard rule: NO AudioContext exists before the first user gesture — init() is
// refused (throws) unless armed by a gesture listener. play()/playBgm() are
// no-ops pre-init so callers never crash. BGM crossfades on era transition;
// mute preference persists to localStorage; every missing file fails silently.

export const SFX_IDS = ['click_choice', 'era_transition', 'lineage_death', 'fork', 'drift',
  'entropy_tick', 'ending_diaspora', 'ending_cathedral', 'ending_stutter', 'ending_ghosts',
  'ending_ascension', 'benthic_ping', 'upgrade',
  // v2.1 (§9.4): files ship with the sfx_ prefix in assets/audio/
  'resource_milestone', 'era_goal_complete', 'choice_deltas'];
// v2.1 ambient beds (§9.4) live alongside the 11 era themes + title.
export const BGM_IDS = ['title', 'cave', 'agriculture', 'bronze', 'dark_ages', 'renaissance',
  'industry', 'american', 'atomic', 'digital', 'connected', 'singularity',
  'choice', 'high_entropy', 'ending'];
// Assets whose on-disk filename carries an sfx_ prefix (Studio v2.1 naming).
export const SFX_FILE_PREFIXED = new Set(['resource_milestone', 'era_goal_complete', 'choice_deltas']);
export function sfxUrl(basePath, id) {
  return `${basePath}/${SFX_FILE_PREFIXED.has(id) ? `sfx_${id}` : id}.ogg`;
}
export const MUTE_KEY = 'long-ascent-muted-v1';
export const CROSSFADE_SEC = 1.2;

export class AudioManager {
  // opts: { basePath, storage, AudioCtx, createMediaElement, now }
  constructor(opts = {}) {
    this.basePath = opts.basePath || 'assets/audio';
    this.storage = opts.storage !== undefined ? opts.storage
      : (typeof localStorage !== 'undefined' ? localStorage : null);
    this._AudioCtx = opts.AudioCtx || (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null);
    this._createEl = opts.createMediaElement || ((tag) => (typeof document !== 'undefined' ? document.createElement(tag) : null));
    this._now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000));
    this.ctx = null;          // created ONLY in init(), which requires a gesture
    this.gestureArmed = false;
    this._muted = this._readMuted();
    this._bgm = [];           // [{ el, gain, source, era }] active bgm tracks (mid-crossfade <=2)
    this._bgmEra = null;
    this._failed = new Set(); // files that errored -> stay silent, no repeat attempts
    this._sources = new Map(); // decoded buffers keyed by sfx id
  }

  get muted() { return this._muted; }
  get initialized() { return !!this.ctx; }

  _readMuted() {
    try { return this.storage?.getItem(MUTE_KEY) === '1'; } catch { return false; }
  }
  _writeMuted() {
    try { this.storage?.setItem(MUTE_KEY, this._muted ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  // Arm the manager from ANY pointer/key/touch event; the actual context is
  // created inside the gesture handler so autoplay policy is satisfied.
  attachGestureUnlock(target) {
    const t = target || (typeof document !== 'undefined' ? document : null);
    if (!t || typeof t.addEventListener !== 'function') return () => {};
    const events = ['pointerdown', 'keydown', 'touchstart'];
    const onGesture = () => {
      for (const ev of events) t.removeEventListener(ev, onGesture);
      this.gestureArmed = true;
      try { this.init(); } catch { /* headless/no WebAudio: stays silent forever */ }
    };
    for (const ev of events) t.addEventListener(ev, onGesture, { passive: true });
    return () => { for (const ev of events) t.removeEventListener(ev, onGesture); };
  }

  // Create the AudioContext. Throws BEFORE a user gesture (the init guard);
  // idempotent after. Returns the context.
  init() {
    if (this.ctx) return this.ctx;
    if (!this.gestureArmed) {
      throw new Error('AudioManager.init() refused: no user gesture yet (Web Audio autoplay policy)');
    }
    if (!this._AudioCtx) throw new Error('AudioManager.init(): no AudioContext available');
    this.ctx = new this._AudioCtx();
    this.master = this.ctx.createGain ? this.ctx.createGain() : null;
    if (this.master) {
      this.master.gain.value = this._muted ? 0 : 1;
      if (this.ctx.destination) this.master.connect(this.ctx.destination);
    }
    if (this.ctx.resume) { try { this.ctx.resume(); } catch { /* ignore */ } }
    return this.ctx;
  }

  mute() {
    this._muted = true;
    this._writeMuted();
    if (this.master && this.master.gain) this.master.gain.value = 0;
  }
  unmute() {
    this._muted = false;
    this._writeMuted();
    if (this.master && this.master.gain) this.master.gain.value = 1;
  }

  // One-shot SFX. Silent when: not initialized, muted, unknown id, or the file
  // previously failed. Never throws.
  play(sfxId) {
    if (!this.ctx || this._muted || !SFX_IDS.includes(sfxId)) return false;
    if (this._failed.has(sfxId)) return false;
    try {
      const url = sfxUrl(this.basePath, sfxId);
      const cached = this._sources.get(sfxId);
      if (cached) { this._playBuffer(cached); return true; }
      // Fetch + decode through Web Audio; failures mark the id dead (silent).
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.arrayBuffer();
      }).then((buf) => this.ctx.decodeAudioData(buf)).then((decoded) => {
        this._sources.set(sfxId, decoded);
        this._playBuffer(decoded);
      }).catch(() => { this._failed.add(sfxId); });
      return true; // playback is async; failure degrades to silence
    } catch {
      this._failed.add(sfxId);
      return false;
    }
  }

  _playBuffer(buffer) {
    if (!this.ctx.createBufferSource) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    if (this.master) src.connect(this.master);
    src.start(0);
  }

  // Play the era BGM loop with a linear crossfade from whatever track was playing.
  // Title screen uses eraId 'title'. v2.1 (§9.4): 'choice' (under event cards) and
  // 'high_entropy' (entropy > 70) are ambient beds, not eras — playBgm still works
  // for them because they share the bgm_[id].ogg contract. Silent fallback on missing files.
  playBgm(bgmId) {
    if (!this.ctx || (bgmId === this._bgmEra && this._bgm.length)) return false;
    this._bgmEra = bgmId;
    if (this._failed.has(bgmId)) return false;
    try {
      const el = this._createEl('audio');
      if (!el) return false;
      el.src = `${this.basePath}/bgm_${bgmId}.ogg`;
      el.loop = true;
      el.preload = 'auto';
      const source = this.ctx.createMediaElementSource ? this.ctx.createMediaElementSource(el) : null;
      const gain = this.ctx.createGain ? this.ctx.createGain() : null;
      if (source && gain) {
        gain.gain.value = 0;
        source.connect(gain);
        if (this.master) gain.connect(this.master);
      }
      const entry = { el, gain, source, era: bgmId };
      const t = this._now();
      // fade out previous tracks
      for (const prev of this._bgm) {
        if (prev.gain?.gain) {
          if (prev.gain.gain.setTargetAtTime) prev.gain.gain.setTargetAtTime(0, t, CROSSFADE_SEC / 3);
          else prev.gain.gain.value = 0;
        }
        setTimeout(() => { try { prev.el.pause(); prev.el.src = ''; } catch { /* noop */ } }, CROSSFADE_SEC * 1000 + 100);
      }
      this._bgm = [entry];
      el.onerror = () => { this._failed.add(bgmId); };
      const p = el.play?.();
      if (p?.catch) p.catch(() => {}); // autoplay/jitter: silent
      if (gain?.gain) {
        if (gain.gain.setTargetAtTime) gain.gain.setTargetAtTime(1, t, CROSSFADE_SEC / 3);
        else gain.gain.value = 1;
      }
      return true;
    } catch {
      this._failed.add(bgmId);
      return false;
    }
  }

  stopBgm() {
    for (const b of this._bgm) { try { b.el.pause(); } catch { /* noop */ } }
    this._bgm = [];
    this._bgmEra = null;
  }
}
