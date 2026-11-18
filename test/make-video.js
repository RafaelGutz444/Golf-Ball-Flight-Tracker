// Writes a synthetic shot as raw RGB frames to stdout for ffmpeg.
const { renderer } = require('./scene.js');
const [W, H, fps] = process.argv.slice(2).map(Number);
const sc = renderer({ W, H, fps, seed: 3, shot: { startDeg: 2, curve: -4 }, noise: 2, impactT: Number(process.argv[5] || 1) });
const out = Buffer.alloc(W * H * 3);
for (let k = 0; k < sc.nFrames; k++) {
  const g = sc.frame(k);
  for (let i = 0; i < g.length; i++) {
    // tint: sky bluish, ground greenish, ball white
    const v = g[i], y = (i / W) | 0, sky = y < H * 0.6;
    out[i * 3] = Math.min(255, v * (sky ? 0.85 : 0.75));
    out[i * 3 + 1] = Math.min(255, v * (sky ? 0.95 : 1.1));
    out[i * 3 + 2] = Math.min(255, v * (sky ? 1.12 : 0.7));
    if (v > 225) { out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = v; }
  }
  process.stdout.write(Buffer.from(out));
}
console.error(JSON.stringify({ ball0: sc.ball0, frames: sc.nFrames }));
