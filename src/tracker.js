// Golf ball flight tracker: pure functions over grayscale frames.
// Works in the browser (global BallTracker) and in Node (module.exports).
(function (root) {
  'use strict';

  function toGray(rgba, out) {
    for (let i = 0, j = 0; j < out.length; i += 4, j++) {
      out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    }
    return out;
  }

  // Find the ball near a tap: brightest 3x3 spot within radius R, then grow the blob.
  function refineBall(g, W, H, x, y, R) {
    x = Math.round(x); y = Math.round(y);
    let best = -1, bx = x, by = y;
    for (let yy = Math.max(1, y - R); yy <= Math.min(H - 2, y + R); yy++) {
      for (let xx = Math.max(1, x - R); xx <= Math.min(W - 2, x + R); xx++) {
        const dx = xx - x, dy = yy - y;
        if (dx * dx + dy * dy > R * R) continue;
        let s = 0;
        for (let k = -1; k <= 1; k++) {
          const o = (yy + k) * W + xx;
          s += g[o - 1] + g[o] + g[o + 1];
        }
        // prefer spots close to the tap when brightness ties
        const score = s - 0.05 * Math.sqrt(dx * dx + dy * dy);
        if (score > best) { best = score; bx = xx; by = yy; }
      }
    }
    const peak = best / 9;
    // background: median on a ring around the spot
    const ring = [];
    const rr = Math.max(6, Math.round(R * 0.6));
    for (let a = 0; a < 48; a++) {
      const px = Math.round(bx + rr * Math.cos(a / 48 * 2 * Math.PI));
      const py = Math.round(by + rr * Math.sin(a / 48 * 2 * Math.PI));
      if (px >= 0 && py >= 0 && px < W && py < H) ring.push(g[py * W + px]);
    }
    ring.sort((a, b) => a - b);
    const bg = ring.length ? ring[ring.length >> 1] : 0;
    const thr = (peak + bg) / 2;
    // flood fill
    const seen = new Set();
    const stack = [by * W + bx];
    let n = 0, sx = 0, sy = 0;
    while (stack.length && n < 1600) {
      const p = stack.pop();
      if (seen.has(p)) continue;
      seen.add(p);
      if (g[p] < thr) continue;
      const px = p % W, py = (p / W) | 0;
      if (Math.abs(px - bx) > 30 || Math.abs(py - by) > 30) continue;
      n++; sx += px; sy += py;
      if (px > 0) stack.push(p - 1);
      if (px < W - 1) stack.push(p + 1);
      if (py > 0) stack.push(p - W);
      if (py < H - 1) stack.push(p + W);
    }
    const cx = n ? sx / n : bx, cy = n ? sy / n : by;
    const r = Math.min(14, Math.max(1.5, Math.sqrt(Math.max(n, 1) / Math.PI)));
    return { x: cx, y: cy, r, contrast: Math.max(0, peak - bg) };
  }

  // Remember what the ball patch looks like so we can tell when it's gone.
  function makeBallModel(g, W, H, ball) {
    const rp = Math.max(1.5, ball.r * 0.9);
    const idx = [], ref = [];
    for (let yy = Math.floor(ball.y - rp); yy <= Math.ceil(ball.y + rp); yy++) {
      for (let xx = Math.floor(ball.x - rp); xx <= Math.ceil(ball.x + rp); xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const dx = xx - ball.x, dy = yy - ball.y;
        if (dx * dx + dy * dy > rp * rp) continue;
        idx.push(yy * W + xx); ref.push(g[yy * W + xx]);
      }
    }
    const thr = Math.max(10, 0.4 * ball.contrast);
    return { ...ball, idx, ref, thr };
  }

  function ballDiff(g, model) {
    let s = 0;
    for (let k = 0; k < model.idx.length; k++) s += Math.abs(g[model.idx[k]] - model.ref[k]);
    return model.idx.length ? s / model.idx.length : 999;
  }

  // Online shot detector: feed frames, it keeps only what's needed around impact.
  class ShotDetector {
    constructor(opts) {
      this.W = opts.W; this.H = opts.H; this.model = opts.model;
      this.maxFps = opts.maxFps || 65;
      this.postSec = opts.postSec || 6;
      this.keepBefore = 6;
      this.frames = [];
      this.lastPresent = -1;
      this.seenPresent = false;
      this.lastT = -Infinity;
      this.done = false;
    }
    // returns true when the shot is complete
    push(gray, t) {
      if (this.done) return true;
      if (t - this.lastT < 1 / this.maxFps - 1e-4) return false;
      this.lastT = t;
      const d = ballDiff(gray, this.model);
      const present = d < this.model.thr;
      this.frames.push({ g: gray, t, present, d });
      if (present) { this.lastPresent = this.frames.length - 1; this.seenPresent = true; }
      // trim frames we no longer need
      const keepFrom = this.seenPresent ? this.lastPresent - this.keepBefore : this.frames.length - this.keepBefore;
      if (keepFrom > 0) {
        this.frames.splice(0, keepFrom);
        this.lastPresent -= keepFrom;
      }
      if (this.seenPresent && t - this.frames[this.lastPresent].t >= this.postSec) this.done = true;
      return this.done;
    }
    get ballGoneFor() {
      if (!this.seenPresent || !this.frames.length) return 0;
      return this.frames[this.frames.length - 1].t - this.frames[this.lastPresent].t;
    }
    result() {
      return { frames: this.frames, impactIdx: this.lastPresent + 1 };
    }
  }

  // Three-frame difference: things that moved in both directions, i.e. not ghosts.
  function detectMovers(prev, cur, next, W, H, thr, yMax, maxArea, out) {
    const N = W * H;
    const mask = out.mask, val = out.val;
    for (let p = 0; p < N; p++) {
      const a = Math.abs(cur[p] - prev[p]);
      const b = next ? Math.abs(cur[p] - next[p]) : a;
      const m = a < b ? a : b;
      val[p] = m;
      mask[p] = m > thr ? 1 : 0;
    }
    const lim = Math.min(H, Math.max(0, Math.floor(yMax))) * W;
    for (let p = lim; p < N; p++) mask[p] = 0;
    const comps = [];
    const stack = out.stack;
    for (let p = 0; p < lim; p++) {
      if (mask[p] !== 1) continue;
      let sp = 0; stack[sp++] = p; mask[p] = 2;
      let n = 0, sw = 0, sx = 0, sy = 0, minx = W, maxx = 0, miny = H, maxy = 0;
      while (sp) {
        const q = stack[--sp];
        const qx = q % W, qy = (q / W) | 0;
        const w = val[q];
        n++; sw += w; sx += qx * w; sy += qy * w;
        if (qx < minx) minx = qx; if (qx > maxx) maxx = qx;
        if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
        if (n > maxArea * 4) continue; // keep draining, it's too big anyway
        if (qx > 0 && mask[q - 1] === 1) { mask[q - 1] = 2; stack[sp++] = q - 1; }
        if (qx < W - 1 && mask[q + 1] === 1) { mask[q + 1] = 2; stack[sp++] = q + 1; }
        if (qy > 0 && mask[q - W] === 1) { mask[q - W] = 2; stack[sp++] = q - W; }
        if (qy < H - 1 && mask[q + W] === 1) { mask[q + W] = 2; stack[sp++] = q + W; }
      }
      if (n > maxArea) continue;
      const ext = Math.max(maxx - minx, maxy - miny) + 1;
      if (ext > Math.sqrt(maxArea) * 3) continue;
      comps.push({ x: sx / sw, y: sy / sw, n, s: sw });
    }
    if (comps.length > 250) {
      comps.sort((a, b) => b.s - a.s);
      comps.length = 250;
    }
    return comps;
  }

  function median(arr) {
    const a = Array.from(arr).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : 0;
  }

  // weighted polynomial (deg 1 or 2) fit of v(t), returns evaluator
  function polyFit(ts, vs, deg) {
    const n = ts.length;
    if (n === 1 || deg === 0) { const m = vs.reduce((a, b) => a + b, 0) / n; return () => m; }
    const t0 = ts[n - 1];
    if (deg === 1 || n < 3) {
      let st = 0, sv = 0, stt = 0, stv = 0;
      for (let i = 0; i < n; i++) { const t = ts[i] - t0; st += t; sv += vs[i]; stt += t * t; stv += t * vs[i]; }
      const den = n * stt - st * st;
      const b = den ? (n * stv - st * sv) / den : 0;
      const a = (sv - b * st) / n;
      return (t) => a + b * (t - t0);
    }
    // normal equations for quadratic
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
    for (let i = 0; i < n; i++) {
      const t = ts[i] - t0, t2 = t * t, v = vs[i];
      S0 += 1; S1 += t; S2 += t2; S3 += t2 * t; S4 += t2 * t2;
      T0 += v; T1 += v * t; T2 += v * t2;
    }
    const M = [[S0, S1, S2, T0], [S1, S2, S3, T1], [S2, S3, S4, T2]];
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return polyFit(ts, vs, 1);
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    const a = M[0][3] / M[0][0], b = M[1][3] / M[1][1], cq = M[2][3] / M[2][2];
    return (t) => { const u = t - t0; return a + b * u + cq * u * u; };
  }

  function analyze(frames, impactIdx, W, H, ball, opts) {
    opts = opts || {};
    const sens = opts.sensitivity || 1;
    if (impactIdx < 1 || impactIdx >= frames.length - 3) return { ok: false, reason: 'no-impact' };
    const n = frames.length;
    const dt = (frames[n - 1].t - frames[0].t) / (n - 1);
    const fps = 1 / Math.max(dt, 1e-3);
    // noise level from a frame pair right after impact
    const f0 = frames[impactIdx - 1].g, f1 = frames[Math.min(n - 1, impactIdx + 2)].g;
    const sample = [];
    for (let p = 0; p < W * H; p += 37) sample.push(Math.abs(f1[p] - f0[p]));
    const noise = median(sample);
    const thr = Math.min(40, Math.max(7, 2.5 * noise + 6)) / sens;
    const r = ball.r;
    const maxArea = Math.max(40, Math.PI * (2.5 * r) * (2.5 * r)) * Math.max(1, 60 / fps);
    const yMax = ball.y + 3 * r + 2;
    const buf = { mask: new Uint8Array(W * H), val: new Uint8Array(W * H), stack: new Int32Array(W * H) };
    const endIdx = n - 1;
    const cands = new Array(n).fill(null);
    // Late in the flight the ball barely moves between frames, so also compare frames further apart.
    const offsets = [1];
    for (const sec of [0.08, 0.2]) { const k = Math.round(sec * fps); if (k > offsets[offsets.length - 1]) offsets.push(k); }
    for (let i = impactIdx; i <= endIdx; i++) {
      let all = [];
      for (const k of offsets) {
        if (k > 1 && frames[i].t - frames[impactIdx].t < 0.3) continue; // early flight is fast
        const a = Math.max(0, i - k), b = i + k < n ? i + k : null;
        if (a === i) continue;
        const cs = detectMovers(frames[a].g, frames[i].g, b === null ? null : frames[b].g, W, H, thr, yMax, maxArea, buf);
        for (const c of cs) if (!all.some(o => Math.abs(o.x - c.x) < 1.5 && Math.abs(o.y - c.y) < 1.5)) all.push(c);
        if (all.length > 400) break;
      }
      cands[i] = all;
    }
    const T = (i) => frames[i].t;
    // how far the ball can move in one frame right after impact
    const R1 = Math.max(0.08 * H, Math.min(0.45 * H, 0.25 * H * (30 / fps)));
    const maxGapSec = 0.35;

    // Two motion models, because a ball flying away from the camera slows down hard on screen:
    // (1) "decay": keep direction, shrink the step each frame by the recent ratio;
    // (2) a quadratic fit of the recent points, which suits the slower, arcing part of the flight.
    function extend(pts) {
      for (;;) {
        const L = pts.length;
        const last = pts[L - 1], prev = pts[L - 2];
        const g1 = Math.max(1e-3, (T(last.i) - T(prev.i)) * fps);
        const vx = (last.x - prev.x) / g1, vy = (last.y - prev.y) / g1;
        const sp1 = Math.hypot(vx, vy);
        let rho = 0.72;
        if (L >= 3) {
          const p2 = pts[L - 3];
          const g0 = Math.max(1e-3, (T(prev.i) - T(p2.i)) * fps);
          const sp0 = Math.hypot(prev.x - p2.x, prev.y - p2.y) / g0;
          if (sp0 > 0.3) rho = Math.min(1.08, Math.max(0.45, Math.pow(sp1 / sp0, 2 / (g0 + g1))));
        }
        let fx = null, fy = null;
        if (L >= 5) {
          const sub = pts.slice(Math.max(0, L - 8));
          const ts = sub.map(p => T(p.i));
          fx = polyFit(ts, sub.map(p => p.x), 2); fy = polyFit(ts, sub.map(p => p.y), 2);
        }
        let found = null;
        for (let j = last.i + 1; j <= endIdx; j++) {
          if (T(j) - T(last.i) > maxGapSec) break;
          const gap = (T(j) - T(last.i)) * fps;
          let geo = 0, rk = 1;
          const gi = Math.max(1, Math.round(gap));
          for (let q = 0; q < gi; q++) { rk *= rho; geo += rk; }
          const preds = [[last.x + vx * geo, last.y + vy * geo]];
          if (fx) preds.push([fx(T(j)), fy(T(j))]);
          const step = sp1 * geo;
          const gate = Math.min(0.12 * H, 2 + 0.3 * step + 0.3 * gap + 0.5 * r);
          let bd = gate, bc = null;
          for (const c of cands[j]) {
            if (sp1 > 2) {
              // a flying ball doesn't turn sharply between frames
              const dx = c.x - last.x, dy = c.y - last.y, dl = Math.hypot(dx, dy);
              if (dl > 1 && (dx * vx + dy * vy) / (dl * sp1) < 0.5) continue;
            }
            for (const pr of preds) {
              const d = Math.hypot(c.x - pr[0], c.y - pr[1]);
              if (d < bd) { bd = d; bc = c; }
            }
          }
          if (bc) { found = { i: j, x: bc.x, y: bc.y, err: bd / gate }; break; }
        }
        if (!found) return pts;
        pts.push(found);
      }
    }

    // count sharp direction flips between steps that are long enough to measure
    function turnPenalty(pts) {
      let pen = 0;
      for (let k = 2; k < pts.length; k++) {
        const ax = pts[k - 1].x - pts[k - 2].x, ay = pts[k - 1].y - pts[k - 2].y;
        const bx = pts[k].x - pts[k - 1].x, by = pts[k].y - pts[k - 1].y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la < 2.5 || lb < 2.5) continue;
        const cos = (ax * bx + ay * by) / (la * lb);
        if (cos < 0.3) pen += 1.5 * (0.3 - cos);
      }
      return pen;
    }

    const seedEnd = Math.min(endIdx, impactIdx + Math.max(2, Math.round(0.05 * fps)));
    let best = null;
    let tries = 0;
    for (let i = impactIdx; i <= seedEnd; i++) {
      const seeds = cands[i].filter(c => Math.hypot(c.x - ball.x, c.y - ball.y) < R1 && c.y < ball.y + 2 * r)
        .sort((a, b) => b.s - a.s).slice(0, 25);
      for (const s of seeds) {
        // second point: moving up, plausible distance
        const seconds = [];
        for (let j = i + 1; j <= Math.min(endIdx, i + 2); j++) {
          for (const c of cands[j]) {
            const d = Math.hypot(c.x - s.x, c.y - s.y);
            if (d < R1 * (j - i) && c.y < s.y - 0.3 && d > 0.5) seconds.push({ i: j, x: c.x, y: c.y, s: c.s, d });
          }
        }
        seconds.sort((a, b) => b.s - a.s);
        for (const s2 of seconds.slice(0, 15)) {
          // the first step should point away from the ball's start
          const vx0 = s.x - ball.x, vy0 = s.y - ball.y;
          if (Math.hypot(vx0, vy0) > 2 * r + 2) {
            const vx1 = s2.x - s.x, vy1 = s2.y - s.y;
            const cos = (vx0 * vx1 + vy0 * vy1) / (Math.hypot(vx0, vy0) * Math.hypot(vx1, vy1));
            if (cos < 0.3) continue;
          }
          tries++;
          const pts = extend([{ i, x: s.x, y: s.y, err: 0 }, { i: s2.i, x: s2.x, y: s2.y, err: 0 }]);
          const dur = T(pts[pts.length - 1].i) - T(pts[0].i);
          const errSum = pts.reduce((a, p) => a + p.err, 0);
          const rise = ball.y - Math.min(...pts.map(p => p.y));
          const score = pts.reduce((a, p) => a + (1 - p.err) * (1 - p.err), 0) + 3 * dur + rise / H * 5 - turnPenalty(pts);
          if (!best || score > best.score) best = { pts, score, dur };
        }
      }
    }
    if (!best || best.pts.length < 5 || best.dur < 0.12) {
      return { ok: false, reason: 'no-track', tries, fps, thr };
    }
    const pts = cleanTrack(best.pts.map(p => ({ x: p.x, y: p.y, t: T(p.i), i: p.i, err: p.err })));
    if (pts.length < 5) return { ok: false, reason: 'no-track', tries, fps, thr };
    return { ok: true, points: smooth(pts), raw: pts, impactT: T(impactIdx), fps, thr, tries, ball };
  }

  // Drop points that don't sit on a smooth path with their neighbours, then cut a ragged tail.
  function looResidual(pts, k, win) {
    const t = pts[k].t, nb = [];
    for (let q = k - 1; q >= 0 && t - pts[q].t <= win; q--) nb.push(pts[q]);
    for (let q = k + 1; q < pts.length && pts[q].t - t <= win; q++) nb.push(pts[q]);
    if (nb.length < 4) return null;
    const ts = nb.map(p => p.t);
    const fx = polyFit(ts, nb.map(p => p.x), 2), fy = polyFit(ts, nb.map(p => p.y), 2);
    return Math.hypot(fx(t) - pts[k].x, fy(t) - pts[k].y);
  }
  function cleanTrack(pts) {
    for (let pass = 0; pass < 2; pass++) {
      const keep = [];
      for (let k = 0; k < pts.length; k++) {
        let res = k < 3 ? null : looResidual(pts, k, 0.3);
        if (res === null && k >= 3) res = looResidual(pts, k, 0.8);
        if (res === null || res < 4) keep.push(pts[k]);
      }
      pts = keep;
    }
    // tail: the ball has landed or vanished once points get sparse and jumpy
    while (pts.length > 6) {
      const tail = pts.slice(-5);
      const meanErr = tail.reduce((a, p) => a + p.err, 0) / tail.length;
      const span = tail[4].t - tail[0].t;
      const lastGap = pts[pts.length - 1].t - pts[pts.length - 2].t;
      if (meanErr > 0.45 || span > 0.6 || lastGap > 0.2) pts.pop(); else break;
    }
    return pts;
  }

  function smooth(pts) {
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      const a = Math.max(0, k - 3), b = Math.min(pts.length, k + 4);
      const sub = pts.slice(a, b);
      const ts = sub.map(p => p.t);
      const fx = polyFit(ts, sub.map(p => p.x), sub.length >= 5 ? 2 : 1);
      const fy = polyFit(ts, sub.map(p => p.y), sub.length >= 5 ? 2 : 1);
      out.push({ x: fx(pts[k].t), y: fy(pts[k].t), t: pts[k].t });
    }
    return out;
  }

  // Shot numbers for a camera standing behind the golfer, looking down the target line.
  function shotStats(track, H, handed) {
    const pts = track.points, ball = track.ball;
    const start = { x: ball.x, y: ball.y };
    const apex = pts.reduce((m, p) => (p.y < m.y ? p : m), pts[0]);
    const air = pts[pts.length - 1].t - track.impactT;
    // start line from the early part of the flight
    const early = pts.filter(p => p.t - track.impactT <= Math.min(0.3, air * 0.3));
    const e = early[early.length - 1] || pts[1];
    const startDeg = Math.atan2(e.x - start.x, start.y - e.y) * 180 / Math.PI;
    // curve: where the ball ends up versus the start line carried on
    const last = pts[pts.length - 1];
    const ux = (e.x - start.x), uy = (e.y - start.y);
    const len = Math.hypot(ux, uy) || 1;
    const lx = last.x - start.x, ly = last.y - start.y;
    const side = (ux * ly - uy * lx) / len; // >0: right of start line in screen terms (y down)
    const curvePct = side / H * 100; // positive = curving right
    let shape = 'Straight';
    const c = curvePct * (handed === 'left' ? -1 : 1);
    if (c > 2) shape = c > 10 ? 'Slice' : 'Fade';
    else if (c < -2) shape = c < -10 ? 'Hook' : 'Draw';
    return {
      airTime: air,
      apexPct: Math.max(0, (start.y - apex.y) / H * 100),
      startDeg,
      curvePct,
      shape,
    };
  }

  const api = { _detect: detectMovers, toGray, refineBall, makeBallModel, ballDiff, ShotDetector, analyze, shotStats, polyFit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BallTracker = api;
})(typeof self !== 'undefined' ? self : this);
