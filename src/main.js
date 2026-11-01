// src/main.js — boot entry (SPEC v6): canvas side-scroller. The idle/quiz DOM
// loop is retired; all state contracts (game.js, migration.js, crossing.js)
// stay intact and are driven by the engine instead of ticks.

import { bootScroller, setPalettes } from './ui/scroller-boot.js';
import { createEntitySystem } from './engine/entities.js';
import * as actionsModule from './engine/actions.js';

const [erasData, encounters, stones, arcs, actionChoices, gatesDoc, spawnTables, v9CopyDoc, entityManifest, echoesDoc, collapseDoc] = await Promise.all([
  fetch('src/data/eras.json').then((r) => r.json()),
  fetch('research/encounters-v6.json').then((r) => r.json()).catch(() => []),
  fetch('research/boundary-stones-v6.json').then((r) => r.json()).catch(() => []),
  fetch('research/arc-encounters-v6.json').then((r) => r.json()).catch(() => []),
  fetch('research/action-choices-v7.json').then((r) => r.json()).catch(() => null),
  fetch('research/gates-v7.json').then((r) => r.json()).catch(() => null),
  fetch('research/spawn-tables-v7.json').then((r) => r.json()).catch(() => null),
  fetch('research/v9-copy.json').then((r) => r.json()).catch(() => null),       // v9 §9 Scribe
  fetch('research/entity-manifest-v9.json').then((r) => r.json()).catch(() => null), // v9 D1 Studio
  fetch('research/echoes-v8.json').then((r) => r.json()).catch(() => null),
  fetch('research/collapse-v8.json').then((r) => r.json()).catch(() => null),
]);

// Studio palettes: fetch per era, tolerate missing files (defaults in boot).
const paletteTable = {};
await Promise.all(
  Array.from({ length: 17 }, (_, i) => i + 1).map((n) =>
    fetch(`assets/palette_era${String(n).padStart(2, '0')}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p) paletteTable[n] = p; })
      .catch(() => {})),
);
setPalettes(paletteTable);

bootScroller({
  erasData,
  content: { encounters, stones, arcs },
  canvas: document.getElementById('world-canvas'),
  hudRoot: document.getElementById('resource-bar'),
  promptRoot: null,  // v9 D3: anchored overlays deleted
  menuRoot: null,    // v9 D3: station panel lives in the chrome band
  toastRoot: document.getElementById('toast'),
  chromeTop: document.getElementById('chrome-top'),
  chromeBottom: document.getElementById('chrome-bottom'),
  options: {
    actionsModule,
    entitySystemFactory: createEntitySystem,
    spawnTables,
    gatesDoc,
    actionChoices,
    v9CopyDoc,
    entityManifest,
    echoesDoc,
    collapseDoc,
  },
});
