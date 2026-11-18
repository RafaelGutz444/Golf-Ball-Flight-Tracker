'use strict';
const BT = require('../src/tracker.js');
const { renderer } = require('./scene.js');

const cases = [
  { name: 'straight 60fps', fps: 60, shot: { startDeg: 0, curve: 0 } },
  { name: 'fade 60fps', fps: 60, shot: { startDeg: -2, curve: 4 } },
  { name: 'draw 30fps', fps: 30, shot: { startDeg: 3, curve: -5 } },
  { name: 'low punch 60fps', fps: 60, shot: { launch: 8, speed: 55, startDeg: 1 } },
  { name: 'noisy + bird 30fps', fps: 30, noise: 4, bird: true, shot: { startDeg: 1, curve: 2 } },
  { name: 'big slice 120fps', fps: 120, shot: { startDeg: -3, curve: 10 } },
  { name: 'dim ball 60fps', fps: 60, ballVal: 225, shot: { startDeg: 0, curve: -2 } },
];

let pass = 0;
for (const c of cases) {
  const sc = renderer({ ...c, seed: 7 });
  const f0 = sc.frame(0);
  const tap = { x: sc.ball0.x + 4, y: sc.ball0.y - 3 };
  const ball = BT.refineBall(f0, sc.W, sc.H, tap.x, tap.y, 20);
  const model = BT.makeBallModel(f0, sc.W, sc.H, ball);
  const det = new BT.ShotDetector({ W: sc.W, H: sc.H, model });
  const t0 = Date.now();
  let k = 0;
  for (; k < sc.nFrames; k++) if (det.push(sc.frame(k), k / sc.fps)) break;
  const { frames, impactIdx } = det.result();
  const ta = Date.now(); const res = BT.analyze(frames, impactIdx, sc.W, sc.H, ball); const msA = Date.now() - ta;
  const ms = Date.now() - t0;
  const impT = frames[impactIdx] && frames[impactIdx].t;
  if (!res.ok) { console.log(`FAIL ${c.name}: ${res.reason} impact@${impT} tries=${res.tries}`); continue; }
  let err = 0, n = 0, maxErr = 0;
  for (const p of res.raw) {
    const tb = sc.trueBall(p.t);
    if (!tb) continue;
    const e = Math.hypot(tb.x - p.x, tb.y - p.y); err += e; n++; maxErr = Math.max(maxErr, e);
  }
  const tracked = res.points[res.points.length - 1].t - res.impactT;
  const cover = tracked / sc.flightTime;
  const st = BT.shotStats(res, sc.H, 'right');
  const ok = cover > 0.5 && maxErr < 6 && Math.abs(impT - sc.impactT) < 2 / sc.fps;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: impact ${impT.toFixed(3)} (true ${sc.impactT}), pts ${res.raw.length}, tracked ${tracked.toFixed(2)}s of ${sc.flightTime.toFixed(2)}s (${(cover * 100).toFixed(0)}%), mean err ${(err / n).toFixed(2)}px max ${maxErr.toFixed(1)}px | ${st.shape} start ${st.startDeg.toFixed(1)}° curve ${st.curvePct.toFixed(1)}% apex ${st.apexPct.toFixed(0)}% | total ${ms}ms, analyze ${msA}ms`);
}
console.log(`${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
