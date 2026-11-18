// Synthetic down-the-line golf shot renderer (grayscale) for testing the tracker.
'use strict';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r()); }

function makeShot(p) {
  // 3D flight: X lateral (right +), Y up, Z downrange. Camera 3 m behind ball, 1.5 m up.
  const g = 9.81;
  const v0 = p.speed || 65, la = (p.launch || 13) * Math.PI / 180, dir = (p.startDeg || 0) * Math.PI / 180;
  let X = 0, Y = 0, Z = 0;
  let vx = v0 * Math.cos(la) * Math.sin(dir), vy = v0 * Math.sin(la), vz = v0 * Math.cos(la) * Math.cos(dir);
  const traj = [];
  const dt = 1 / 960;
  let t = 0;
  while (Y >= 0 && t < 9) {
    traj.push({ t, X, Y, Z });
    const v = Math.hypot(vx, vy, vz);
    const kd = 0.0045, kl = p.lift || 0.0040;
    vx += (-kd * v * vx + (p.curve || 0) * (v / v0)) * dt;
    vy += (-g - kd * v * vy + kl * v * v * 0.9) * dt;
    vz += (-kd * v * vz) * dt;
    X += vx * dt; Y += vy * dt; Z += vz * dt; t += dt;
  }
  return traj;
}

function project(P, cam) {
  const d = P.Z + cam.back;
  return { x: cam.cx + cam.f * P.X / d, y: cam.hy - cam.f * (P.Y - cam.h) / d, r: cam.f * 0.0214 / d };
}

function renderer(opts) {
  const W = opts.W || 360, H = opts.H || 640, fps = opts.fps || 60;
  const R = rng(opts.seed || 1);
  const cam = { cx: W * 0.5, hy: H * 0.6, h: 1.5, back: 3, f: 360 * (W / 360) };
  const ball0 = project({ X: 0, Y: 0, Z: 0 }, cam);
  const bg = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v;
    if (y < cam.hy) v = (opts.sky || 195) - 25 * (1 - y / cam.hy);
    else v = 85 + 20 * R() + 10 * Math.sin(x * 0.3 + y * 0.7);
    bg[y * W + x] = v;
  }
  // tree line near the horizon
  for (let x = 0; x < W; x++) {
    const th = 18 + 12 * Math.sin(x * 0.05) + 6 * Math.sin(x * 0.23);
    for (let y = Math.round(cam.hy - th); y < cam.hy; y++) bg[y * W + x] = 70 + 10 * R();
  }
  const traj = makeShot(opts.shot || {});
  const impactT = opts.impactT || 1.0;
  const total = impactT + traj[traj.length - 1].t + 0.6;
  const nFrames = Math.round(total * fps);
  const noise = opts.noise == null ? 2.5 : opts.noise;
  const hands = { x: ball0.x - 55, y: ball0.y - 120 };

  function trueBall(t) {
    const ft = t - impactT;
    if (ft < 0) return { x: ball0.x, y: ball0.y, r: ball0.r, flying: false };
    const k = Math.min(traj.length - 1, Math.round(ft * 960));
    if (ft > traj[traj.length - 1].t) return null;
    return { ...project(traj[k], cam), flying: true };
  }

  function disk(img, cx, cy, r, val, alphaMul) {
    const rr = Math.max(r, opts.minR || 0.75);
    const a = alphaMul * Math.min(1, (r * r) / (rr * rr) * 1.0 + 0.0);
    for (let y = Math.floor(cy - rr - 1); y <= Math.ceil(cy + rr + 1); y++) for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr + 1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      // 4x4 supersampled coverage
      let cov = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const dx = x + (sx + 0.5) / 4 - 0.5 - cx, dy = y + (sy + 0.5) / 4 - 0.5 - cy;
        if (dx * dx + dy * dy <= rr * rr) cov++;
      }
      cov /= 16;
      const w = cov * Math.max(a, 0.55);
      img[y * W + x] = img[y * W + x] * (1 - w) + val * w;
    }
  }
  function thickLine(img, x0, y0, x1, y1, th, val) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      for (let dy = -th; dy <= th; dy++) for (let dx = -th; dx <= th; dx++) {
        const xx = Math.round(x + dx), yy = Math.round(y + dy);
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) img[yy * W + xx] = val;
      }
    }
  }

  function frame(k) {
    const t = k / fps;
    const img = Float32Array.from(bg);
    // swing phase: address until impactT-1.2, backswing, downswing to impact, follow-through
    const s = t - impactT;
    let ang; // club angle, 0 = pointing at ball
    if (s < -1.0) ang = 0;
    else if (s < -0.25) ang = -2.6 * ((s + 1.0) / 0.75);
    else if (s < 0) ang = -2.6 * (1 - (s + 0.25) / 0.25) ** 1.6;
    else ang = Math.min(3.2, 12 * s);
    const sway = 6 * Math.sin(Math.min(1, Math.max(0, s + 1)) * Math.PI);
    // body
    for (let y = Math.round(hands.y - 110); y < hands.y + 150; y++) for (let x = Math.round(hands.x - 40 + sway); x < hands.x + 20 + sway; x++) {
      const ex = (x - (hands.x - 10 + sway)) / 32, ey = (y - (hands.y + 20)) / 130;
      if (ex * ex + ey * ey < 1 && x >= 0 && y >= 0 && x < W && y < H) img[y * W + x] = 45;
    }
    disk(img, hands.x - 10 + sway, hands.y - 125, 16, 60, 1);
    // club from hands
    const base = Math.atan2(ball0.y - hands.y, ball0.x - hands.x);
    const len = Math.hypot(ball0.x - hands.x, ball0.y - hands.y) - 4;
    const a = base + ang;
    const hx = hands.x + sway + len * Math.cos(a), hy = hands.y + len * Math.sin(a);
    thickLine(img, hands.x + sway, hands.y, hx, hy, 1, 30);
    disk(img, hx - 4, hy, 5, 140, 1);
    // bird distractor
    if (opts.bird) {
      const bx = (40 + 50 * t) % W, by = 120 + 20 * Math.sin(t * 2);
      disk(img, bx, by, 1.3, 60, 1);
    }
    const b = trueBall(t);
    if (b) disk(img, b.x, b.y, b.r, opts.ballVal || 245, 1);
    const out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i++) {
      const v = img[i] + noise * gauss(R);
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return out;
  }
  return { W, H, fps, nFrames, frame, trueBall, ball0, impactT, flightTime: traj[traj.length - 1].t };
}

module.exports = { renderer };
