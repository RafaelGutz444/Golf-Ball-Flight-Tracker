'use strict';
// Clean simulated shots (no compression). Curve isn't visible in the first frames, so late error allows for it.
const { runAll } = require('./harness.js');
const cases = [
  { name: 'straight 60fps', fps: 60, shot: { startDeg: 0, curve: 0 } },
  { name: 'fade 60fps', fps: 60, shot: { startDeg: -2, curve: 4 } },
  { name: 'draw 30fps', fps: 30, shot: { startDeg: 3, curve: -5 } },
  { name: 'low punch 60fps', fps: 60, shot: { launch: 8, speed: 55, startDeg: 1 } },
  { name: 'noisy + bird 30fps', fps: 30, noise: 4, bird: true, shot: { startDeg: 1, curve: 2 } },
  { name: 'slice 120fps', fps: 120, shot: { startDeg: -3, curve: 10 }, limit: { early: 8, late: 90 } },
  { name: 'dim ball 60fps', fps: 60, ballVal: 225, shot: { startDeg: 0, curve: -2 } },
];
process.exit(runAll(cases, process.argv[2]) ? 0 : 1);
