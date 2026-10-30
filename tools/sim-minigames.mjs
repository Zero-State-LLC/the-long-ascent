// tools/sim-minigames.mjs — deterministic winnability harness (spec v5 §3).
// Plays every family with the greedy autopilot across difficulties/seeds and
// prints win rows, plus a no-input softlock check. Run: node tools/sim-minigames.mjs [seeds]
import { simulate, createRun, step, FAMILIES } from '../src/core/minigames.js';

const N = Number(process.argv[2] || 10);
for (const fam of Object.keys(FAMILIES)) {
  for (const diff of [0, 0.5, 1]) {
    const wins = [];
    let first = null;
    for (let s = 1; s <= N; s++) {
      const r = simulate(fam, s, diff);
      wins.push(r.won ? 1 : 0);
      if (!first) first = r;
    }
    console.log(`${fam} d${diff}: ${wins.join('')} | target ${first.target} score ${first.score} | t ${first.t.toFixed(1)}/${first.dur.toFixed(1)}`);
  }
}
console.log('--- no-input softlock check ---');
for (const fam of Object.keys(FAMILIES)) {
  let run = createRun(fam, { seed: 7, diff: 0 });
  let guard = 0;
  while (!run.done && guard++ < 10000) run = step(run, 1 / 30);
  console.log(`${fam}: done=${run.done} after ${run.t.toFixed(1)}s (guard ${guard})`);
}
