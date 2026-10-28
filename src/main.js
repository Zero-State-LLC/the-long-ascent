// src/main.js — Entry point: load generated data, boot the UI. Plain ES modules, no build step.
import { bootApp } from './ui/dom-boot.js';

const [erasRes, eventsRes, copyRes] = await Promise.all([
  fetch('./src/data/eras.json'),
  fetch('./src/data/events.json'),
  // v2.1 copy ships with the repo; a missing file must never gate boot.
  fetch('./src/data/v21-copy.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
]);
bootApp({ erasData: await erasRes.json(), eventsData: await eventsRes.json(), copyData: copyRes });
