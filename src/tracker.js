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
    const thr = Math.min(40, Math.max(8, 2.5 * noise + 6)) / sens;
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
    const R1 = Math.max(0.12 * H, Math.min(0.6 * H, 0.4 * H * (30 / fps)));
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
          if (T(j) - T(last.i) > maxGapSec || T(j) - T(impactIdx) > 0.8) break;
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

    const seedEnd = Math.min(endIdx, impactIdx + Math.max(2, Math.round(0.1 * fps)));
    const hyps = [];
    let tries = 0;
    for (let i = impactIdx; i <= seedEnd; i++) {
      const seedR = R1 * (i - impactIdx + 1);
      const seeds = cands[i].filter(c => Math.hypot(c.x - ball.x, c.y - ball.y) < seedR && c.y < ball.y + 2 * r)
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
          const score = pts.slice(0, 10).reduce((a, p) => a + (1 - p.err) * (1 - p.err), 0) - turnPenalty(pts.slice(0, 10));
          hyps.push({ pts, score });
        }
      }
    }

    // Fit the flight model to the best-looking early tracks and keep the one it explains best.
    const tc = T(impactIdx) - 0.5 / fps; // contact happened between the last "ball there" frame and this one
    const cam = makeCamera(W, H, ball);
    const pxScale = H / 640 > 1 ? H / 640 : Math.max(W, H) / 640;
    // Early on a golf ball flies in a nearly straight 3D line, and a straight line stays straight on
    // screen. So rank tracks by how well their first points line up with the ball's starting spot;
    // a swinging club or arm traces an arc that doesn't.
    for (const h of hyps) {
      const e = h.pts.slice(0, 5);
      if (e.length < 3) { h.line = Infinity; continue; }
      const last = e[e.length - 1];
      const ux = last.x - ball.x, uy = last.y - ball.y, L = Math.hypot(ux, uy) || 1;
      let dev = 0;
      for (const p of e) dev += Math.abs(((p.x - ball.x) * uy - (p.y - ball.y) * ux) / L);
      h.line = dev / e.length / Math.max(1, Math.max(W, H) / 640) - 0.15 * h.pts.slice(0, 10).length;
    }
    hyps.sort((a, b) => a.line - b.line);
    if (opts.debug) { opts.debug('hyps', hyps.length); for (const h of hyps) if (Math.abs(h.pts[0].x - ball.x) < 15) opts.debug('near-ball hyp', h.score.toFixed(2), h.pts.slice(0, 8).map(p => `${p.i}:${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ')); }
    let best = null;
    const seen = new Set();
    const screened = [];
    for (const h of hyps) {
      if (seen.size >= 30) break;
      const key = h.pts.slice(0, 3).map(p => p.i + ':' + Math.round(p.x) + ',' + Math.round(p.y)).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const early = h.pts.slice(0, 10);
      if (early.length < 3) continue;
      // a launched ball keeps getting further from the tee and keeps rising early on
      let okShape = true;
      for (let k = 1; k < early.length; k++) {
        const d0 = Math.hypot(early[k - 1].x - ball.x, early[k - 1].y - ball.y), d1 = Math.hypot(early[k].x - ball.x, early[k].y - ball.y);
        if (d1 < d0 - 1.5 * pxScale) { okShape = false; break; }
      }
      if (!okShape) { if (opts.debug) opts.debug('shape-reject', early.map(p => `${p.i}:${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ')); continue; }
      const obs = early.map(p => ({ t: T(p.i) - tc, x: p.x, y: p.y, i: p.i }));
      const quick = fitFlight(obs, cam, fps, ball, true);
      if (quick.rms < 4 * pxScale) screened.push({ obs, quick });
    }
    screened.sort((a, b) => (a.quick.rms - a.obs.length * 0.3) - (b.quick.rms - b.obs.length * 0.3));
    for (const { obs } of screened.slice(0, 4)) {
      const fit = fitFlight(obs, cam, fps, ball);
      if (opts.debug) opts.debug('fit', 'rms', fit.rms.toFixed(2), obs.map(o => `${o.t.toFixed(3)}:${o.x.toFixed(0)},${o.y.toFixed(0)}`).join(' '));
      if (fit.rms > 2.5 * pxScale) continue;
      const q = obs.length - fit.rms / pxScale;
      if (!best || q > best.q) best = { q, obs, fit };
    }

    if (!best) {
      // We saw the ball leave but not where it went: give a typical flight the user can adjust.
      const p = { ...DEFAULT_SHOT };
      return finish(p, [], true);
    }

    // Look for the ball further along the predicted path and refine the fit with what we find.
    let obs = best.obs, p = best.fit.p, added = 0;
    for (let j = obs[obs.length - 1].i + 1; j <= endIdx; j++) {
      const t = T(j) - tc;
      if (t > 1.5) break;
      // the curve can't be seen in the first few frames, so look along a fan of curved paths
      const gate = (2.5 + 4 * t) * pxScale;
      let bc = null, bd = gate;
      for (const dc of [0, -4, 4, -9, 9, -15, 15]) {
        const pr = predictAt({ ...p, curve: (p.curve || 0) + dc }, cam, [Math.max(0, t + p.dt0)])[0];
        for (const c of cands[j]) { const d = Math.hypot(c.x - pr.x, c.y - pr.y) + Math.abs(dc) * 0.05; if (d < bd) { bd = d; bc = c; } }
      }
      if (!bc) continue;
      obs.push({ t, x: bc.x, y: bc.y, i: j });
      if (++added % 4 === 0) {
        const f = fitFlight(obs, cam, fps, ball, false, p);
        if (f.rms < 2.5 * pxScale) p = f.p; else { obs.pop(); }
      }
    }
    if (added % 4 !== 0) { const f = fitFlight(obs, cam, fps, ball, false, p); if (f.rms < 2.5 * pxScale) p = f.p; }
    return finish(p, obs, false);

    function finish(p, obs, estimated) {
      const fp = flightPath(p, cam, 1 / 60);
      const toAbs = (t) => tc + t - (p.dt0 || 0);
      return {
        ok: true, estimated,
        points: fp.pts.map(q => ({ x: q.x, y: q.y, t: toAbs(q.t) })),
        raw: obs.map(o => ({ x: o.x, y: o.y, t: o.t + tc, i: o.i })),
        seenSec: obs.length ? obs[obs.length - 1].t : 0,
        params: p, cam, contactT: tc,
        hang: fp.hang, carry: fp.carry, apexM: fp.apex,
        impactT: T(impactIdx), fps, thr, tries, ball,
      };
    }
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


  // ---------------------------------------------------------------------------
  // Ball flight model. In phone video the ball is only visible for the first
  // ~0.1-0.5 s, so we fit a simple 3D flight to what we saw and draw the rest.
  // Camera assumptions: phone roughly level, looking down the target line from
  // behind the ball, ~68 degrees across the long side of the frame, ~1.3 m up.
  // ---------------------------------------------------------------------------
  const PHYS = { g: 9.81, kd: 0.0045, kl: 0.0036 };

  function makeCamera(W, H, ball) {
    const f = 0.74 * Math.max(W, H), cx = W / 2, hc = 1.3;
    let yh = H / 2;
    // distance from the camera to the ball, from how far below the horizon it sits
    let D = f * hc / Math.max(1, ball.y - yh);
    if (!(D > 1.2 && D < 8)) { D = Math.min(8, Math.max(1.2, D || 2.75)); yh = ball.y - f * hc / D; }
    const X0 = (ball.x - cx) * D / f;
    return { f, cx, yh, hc, D, X0, W, H };
  }

  function project(cam, X, Y, Z) {
    const z = Math.max(0.05, Z);
    return { x: cam.cx + cam.f * X / z, y: cam.yh - cam.f * (Y - cam.hc) / z };
  }

  // p: {v0 m/s, la deg, dir deg (+ right), curve m/s^2 (+ right), lift multiplier}
  function simulate(p, cam, tEnd, step, onSample) {
    const la = p.la * Math.PI / 180, dir = p.dir * Math.PI / 180;
    let X = cam.X0, Y = 0, Z = cam.D;
    let vx = p.v0 * Math.cos(la) * Math.sin(dir), vy = p.v0 * Math.sin(la), vz = p.v0 * Math.cos(la) * Math.cos(dir);
    const dt = 1 / 600, kl = PHYS.kl * (p.lift || 1);
    let t = 0, nextS = 0, apex = 0;
    while (t <= tEnd + 1e-9) {
      if (t >= nextS - 1e-9) { onSample(t, X, Y, Z); nextS += step; }
      const v = Math.hypot(vx, vy, vz);
      // sidespin pushes sideways, at right angles to the ball's path, so it bends the flight without speeding it up
      const vh = Math.hypot(vx, vz) || 1, side = p.curve * (v / Math.max(1, p.v0));
      vx += (-PHYS.kd * v * vx + side * vz / vh) * dt;
      vy += (-PHYS.g - PHYS.kd * v * vy + kl * v * v) * dt;
      vz += (-PHYS.kd * v * vz - side * vx / vh) * dt;
      X += vx * dt; Y += vy * dt; Z += vz * dt; t += dt;
      if (Y > apex) apex = Y;
      if (Y < 0 && t > 0.2) { onSample(t, X, 0, Z); break; }
    }
    return { t, X, Z, apex };
  }

  function flightPath(p, cam, step) {
    const pts = [];
    const end = simulate(p, cam, 12, step || 1 / 60, (t, X, Y, Z) => { const q = project(cam, X, Y, Z); pts.push({ t, x: q.x, y: q.y }); });
    const carry = Math.hypot(end.X - cam.X0, end.Z - cam.D);
    return { pts, hang: end.t, carry, apex: end.apex };
  }

  // screen positions at given times since contact
  function predictAt(p, cam, times) {
    const out = new Array(times.length);
    let k = 0;
    const order = times.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]);
    const tEnd = order.length ? order[order.length - 1][0] : 0;
    let prev = null;
    simulate(p, cam, tEnd + 1 / 600, 1 / 600, (t, X, Y, Z) => {
      while (k < order.length && order[k][0] <= t + 1e-9) {
        const q = project(cam, X, Y, Z);
        out[order[k][1]] = q; k++;
      }
      prev = [X, Y, Z];
    });
    while (k < order.length) { const q = prev ? project(cam, prev[0], prev[1], prev[2]) : { x: NaN, y: NaN }; out[order[k][1]] = q; k++; }
    return out;
  }

  function nelderMead(fn, x0, steps, iters) {
    const n = x0.length;
    let simplex = [x0.slice()];
    for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += steps[i]; simplex.push(x); }
    let vals = simplex.map(fn);
    for (let it = 0; it < iters; it++) {
      const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
      simplex = idx.map(i => simplex[i]); vals = idx.map(i => vals[i]);
      if (Math.abs(vals[n] - vals[0]) < 1e-6 * (1 + Math.abs(vals[0]))) break;
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
      const ref = c.map((v, j) => v + (v - simplex[n][j]));
      const fr = fn(ref);
      if (fr < vals[0]) {
        const exp = c.map((v, j) => v + 2 * (v - simplex[n][j]));
        const fe = fn(exp);
        if (fe < fr) { simplex[n] = exp; vals[n] = fe; } else { simplex[n] = ref; vals[n] = fr; }
      } else if (fr < vals[n - 1]) { simplex[n] = ref; vals[n] = fr; }
      else {
        const con = c.map((v, j) => v + 0.5 * (simplex[n][j] - v));
        const fc = fn(con);
        if (fc < vals[n]) { simplex[n] = con; vals[n] = fc; }
        else {
          for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); vals[i] = fn(simplex[i]); }
        }
      }
    }
    let bi = 0; for (let i = 1; i <= n; i++) if (vals[i] < vals[bi]) bi = i;
    return { x: simplex[bi], f: vals[bi] };
  }

  // obs: [{t (since contact estimate), x, y}]. Returns {p, rms, dt0}.
  function fitFlight(obs, cam, fps, ball, quick, init) {
    const span = obs.length ? obs[obs.length - 1].t : 0;
    const fitCurve = span > 0.25;
    const sig = Math.max(1, 1.2 * cam.H / 640);
    const half = 0.5 / fps;
    const unpack = (q) => ({ v0: q[0], la: q[1], dir: q[2], curve: fitCurve ? q[3] : 0, lift: 1, dt0: q[4] });
    const cost = (q) => {
      const p = unpack(q);
      let c = 0;
      if (p.v0 < 15 || p.v0 > 90 || p.la < 1 || p.la > 45 || Math.abs(p.dir) > 30 || Math.abs(p.dt0) > 2 * half) c += 1e6;
      const pr = predictAt(p, cam, obs.map(o => Math.max(0, o.t + p.dt0)));
      for (let i = 0; i < obs.length; i++) {
        const dx = (pr[i].x - obs[i].x) / sig, dy = (pr[i].y - obs[i].y) / sig;
        const e2 = dx * dx + dy * dy;
        c += e2 < 9 ? e2 : 6 * Math.sqrt(e2) - 9; // robust beyond 3 sigma
      }
      c += ((p.v0 - 58) / 22) ** 2 + ((p.la - 14) / 9) ** 2 + (p.dir / 15) ** 2 + (fitCurve ? (q[3] / 8) ** 2 : 0) + (p.dt0 / half) ** 2;
      return c;
    };
    // starting guess for direction from the first sighting
    const o0 = obs[Math.min(obs.length - 1, 1)] || { x: ball.x, y: ball.y };
    const dirGuess = Math.max(-20, Math.min(20, Math.atan2(o0.x - ball.x, Math.max(1, ball.y - o0.y)) * 180 / Math.PI * 0.6));
    let best = null;
    if (init) best = nelderMead(cost, [init.v0, init.la, init.dir, init.curve || 0, init.dt0 || 0], [4, 2, 1.5, 1.5, half / 2], 250);
    else for (const v0 of quick ? [60] : [40, 60, 75]) for (const la of [9, 15, 24]) {
      const r = nelderMead(cost, [v0, la, dirGuess, 0, 0], [8, 4, 3, 2, half], quick ? 120 : 220);
      if (!best || r.f < best.f) best = r;
    }
    const r = quick ? best : nelderMead(cost, best.x, [3, 1.5, 1, 1, half / 2], 300);
    const p = unpack(r.x);
    const pr = predictAt(p, cam, obs.map(o => Math.max(0, o.t + p.dt0)));
    let se = 0;
    for (let i = 0; i < obs.length; i++) se += (pr[i].x - obs[i].x) ** 2 + (pr[i].y - obs[i].y) ** 2;
    return { p, rms: Math.sqrt(se / Math.max(1, obs.length)), cost: r.f };
  }

  const DEFAULT_SHOT = { v0: 58, la: 14, dir: 0, curve: 0, lift: 1, dt0: 0 };

  const api = { Flight: { makeCamera, project, simulate, flightPath, predictAt, fitFlight, DEFAULT_SHOT, PHYS }, _detect: detectMovers, toGray, refineBall, makeBallModel, ballDiff, ShotDetector, analyze, shotStats, polyFit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BallTracker = api;
})(typeof self !== 'undefined' ? self : this);
