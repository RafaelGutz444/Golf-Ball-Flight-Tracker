'use strict';
// Harder, phone-like shots: motion blur, bright or cloudy sky, H.264 compression, and a camera
// that doesn't match the app's assumptions exactly.
const { runAll } = require('./harness.js');
const cases = [
  { name: 'bright sky 60fps', fps: 60, sky: 215, shutter: 1 / 240, crf: 23, shot: { startDeg: 1, curve: -2 } },
  { name: 'cloudy 60fps', fps: 60, sky: 205, clouds: 8, shutter: 1 / 240, crf: 23, shot: { startDeg: -1, curve: 3 } },
  { name: 'cloudy 30fps', fps: 30, sky: 205, clouds: 8, shutter: 1 / 120, crf: 23, shot: { startDeg: 2, curve: -4 }, limit: { early: 8, late: 55 } },
  { name: 'driver, heavy compression', fps: 60, sky: 210, shutter: 1 / 240, crf: 30, shot: { speed: 75, launch: 11, startDeg: 0, curve: 2 } },
  { name: 'camera lower and closer, tilted', fps: 60, sky: 210, shutter: 1 / 240, crf: 23, cam: { h: 1.0, back: 2.0, hy: 0.46 }, shot: { startDeg: 1, curve: 0 }, limit: { early: 10, late: 70 } },
];
process.exit(runAll(cases, process.argv[2]) ? 0 : 1);
