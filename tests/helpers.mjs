// Shared test helpers: deterministic random + scripted bot policy.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A scripted policy that reaches a chosen ending, while keeping the lineage
// alive long enough to get there (avoids entropy collapse).
// mode: 'diaspora' | 'cathedral' | 'stutter' | 'bureaucracy' | 'ascension' | 'random'
// opts.strictNoSeed: never take a seed_* flag; abstain (return null) when every
//   choice would claim one — the no-trajectory (Ascension) path.
export function makePolicy(mode, rng, opts = {}) {
  const isSeedOnlyEvent = (event) =>
    event.choices.every((c) => c.flags.some((f) => f.startsWith('seed_') && f !== 'seed_none_claimed'));

  return function choose(event, state) {
    if (event.id.startsWith('T')) {
      const i = { diaspora: 0, cathedral: 1, stutter: 2, bureaucracy: 0, ascension: 2, random: Math.floor(rng() * event.choices.length) }[mode] ?? 0;
      return event.choices[Math.min(i, event.choices.length - 1)];
    }
    if (event.kind === 'lineage') return event.choices[0]; // name the heir; keep going

    if (opts.strictNoSeed && isSeedOnlyEvent(event)) {
      // Abstain from the trajectory: signal via state.flags and let the
      // no-trajectory evaluator decide at the finale (SPEC §3.4 Ascension).
      if (!state.flags.includes('seed_none_claimed')) state.flags.push('seed_none_claimed');
      return null;
    }

    if (event.id === 'E11-12' && wantSeed(mode)) {
      const c = event.choices.find((ch) => ch.flags.includes(wantSeed(mode)));
      if (c) return c;
    }

    // Survival bias: avoid big entropy gains late; otherwise favor knowledge.
    let best = event.choices[0], bestScore = -Infinity;
    for (const c of event.choices) {
      let s = (c.effects.knowledge || 0) - (c.effects.entropy || 0) * (state.era >= 6 ? 2 : 0.5)
        + (c.effects.legitimacy || 0) * 0.3;
      if (mode === 'random') s = rng();
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  };
}

function wantSeed(mode) {
  return {
    diaspora: 'seed_diaspora',
    cathedral: 'seed_cathedral',
    stutter: 'seed_stutter',
    bureaucracy: 'seed_bureaucracy',
  }[mode] || null;
}
