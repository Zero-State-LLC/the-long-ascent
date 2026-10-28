// Entry point: load generated data, boot the UI. Plain ES modules, no build step.
import { bootApp } from './ui/app.js';

const [erasRes, eventsRes] = await Promise.all([
  fetch('./src/data/eras.json'),
  fetch('./src/data/events.json'),
]);
bootApp({ erasData: await erasRes.json(), eventsData: await eventsRes.json() });
