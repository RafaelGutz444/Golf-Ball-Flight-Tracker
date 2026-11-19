'use strict';
// Runs one simulated shot through the tracker the way the app does and scores the result.
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const BT = require('../src/tracker.js');
const { renderer } = require('./scene.js');

function framesFor(c) {
  if (!c.crf) {
    const sc = renderer({ ...c, seed: c.seed || 7 });
    return { sc, W: sc.W, H: sc.H, n: sc.nFrames, get: (k) => sc.frame(k), truth: sc.trueBall };
  }
  // phone-like: render at 720x1280, H.264 round trip, then downscale 2x like the app does
  const sc = renderer({ ...c, seed: c.seed || 11, W: 720, H: 1280 });
  const raw = Buffer.alloc(sc.W * sc.H * sc.nFrames);
  for (let k = 0; k < sc.nFrames; k++) raw.set(sc.frame(k), k * sc.W * sc.H);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-'));
  const mp4 = path.join(tmp, 'v.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${sc.W}x${sc.H}`, '-r', String(sc.fps), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(c.crf), '-pix_fmt', 'yuv420p', mp4], { input: raw, maxBuffer: 1 << 30 });
  const dec = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', mp4, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
  fs.rmSync(tmp, { recursive: true, force: true });
  const FN = sc.W * sc.H, W = sc.W / 2, H = sc.H / 2, src = new Uint8Array(dec.buffer, dec.byteOffset, dec.length);
  const get = (k) => {
    const o = new Uint8Array(W * H), b = k * FN;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = b + (2 * y) * sc.W + 2 * x;
      o[y * W + x] = (src[i] + src[i + 1] + src[i + sc.W] + src[i + sc.W + 1] + 2) >> 2;
    }
    return o;
  };
  const truth = (t) => { const b = sc.trueBall(t); return b && { x: b.x / 2, y: b.y / 2, r: b.r / 2 }; };
  return { sc, W, H, n: dec.length / FN, get, truth };
}

function runCase(c) {
  const v = framesFor(c);
  const { sc, W, H } = v;
  const b0 = v.truth(0);
  const f0 = v.get(0);
  const ball = BT.refineBall(f0, W, H, b0.x + 4, b0.y - 3, 20);
  const det = new BT.ShotDetector({ W, H, model: BT.makeBallModel(f0, W, H, ball), postSec: 1.5 });
  for (let k = 0; k < v.n; k++) if (det.push(v.get(k), k / sc.fps)) break;
  const { frames, impactIdx } = det.result();
  const t0 = Date.now();
  const res = BT.analyze(frames, impactIdx, W, H, ball, process.env.DEBUG ? { debug: (...a) => console.log(...a) } : {});
  if (process.env.DEBUG) { console.log('impact', frames[impactIdx].t, 'ball', JSON.stringify(ball)); for (let k = 1; k <= 8; k++) { const tb = v.truth(sc.impactT + k / sc.fps); console.log('truth', (k / sc.fps).toFixed(3), tb && tb.x.toFixed(0), tb && tb.y.toFixed(0)); } }
  const ms = Date.now() - t0;
  if (!res.ok) return { ok: false, line: `FAIL ${c.name}: ${res.reason}` };
  // compare the drawn tracer with the true flight at a few moments
  const at = (t) => { const pts = res.points; let k = pts.findIndex(p => p.t >= t); if (k < 0) return null; return pts[k]; };
  const errs = {};
  for (const dt of [0.1, 0.25, 0.5, 1, 2, 3]) {
    const tb = v.truth(sc.impactT + dt), q = at(sc.impactT + dt);
    errs[dt] = tb && q ? Math.hypot(tb.x - q.x, tb.y - q.y) / (H / 640) : null;
  }
  const hangErr = Math.abs(res.hang - sc.flightTime);
  const early = Math.max(errs[0.1] || 0, errs[0.25] || 0, errs[0.5] || 0);
  const limit = c.limit || { early: 8, late: 40 };
  const late = Math.max(errs[1] || 0, errs[2] || 0, errs[3] || 0);
  const ok = !res.estimated && early < limit.early && late < limit.late;
  const fmt = (x) => (x == null ? '-' : x.toFixed(0));
  return {
    ok,
    line: `${ok ? 'PASS' : 'FAIL'} ${c.name}: ${res.estimated ? 'ESTIMATED (ball not found) ' : ''}seen ${res.seenSec.toFixed(2)}s (${res.raw.length} pts), path error px @0.1/0.25/0.5/1/2/3s: ${[0.1, 0.25, 0.5, 1, 2, 3].map(d => fmt(errs[d])).join('/')}, hang ${res.hang.toFixed(1)} vs ${sc.flightTime.toFixed(1)}s, fit v0 ${res.params.v0.toFixed(0)} la ${res.params.la.toFixed(1)} | ${ms}ms`,
  };
}

function runAll(cases, filter) {
  let pass = 0, run = 0;
  for (const c of cases) {
    if (filter && !c.name.includes(filter)) continue;
    run++;
    const r = runCase(c);
    if (r.ok) pass++;
    console.log(r.line);
  }
  console.log(`${pass}/${run} passed`);
  return pass === run;
}

module.exports = { runCase, runAll };
