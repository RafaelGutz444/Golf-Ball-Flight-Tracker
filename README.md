# Fairway Tracer

Phone web app that traces a golf ball's flight, TV style.

- `src/tracker.js` – tracking engine (no dependencies). Ball found from a tap; impact = ball disappears from its spot; flight found with three-frame differencing at several frame spacings, then linked into a track with a decelerating-motion model plus a quadratic fit.
- `src/app.html` – the app: Live mode (camera, needs a normal HTTPS page) and Clip mode (record or pick a video).
- `node build.js` → `dist/index.html` (standalone, opens in Live mode) and `dist/artifact.html` (Claude Artifact body).
- `node test/run-sim.js` – 7 simulated shots (straight, fade, draw, punch, noisy with a bird, slice at 120 fps, dim ball).
- `test/e2e-clip.js`, `test/e2e-live.js` – Playwright runs against `dist/` served on :8765 (live uses Chromium's fake camera fed with a synthetic .y4m).

Assumes the phone is on a tripod behind the golfer, looking down the target line.

## Hosting

Every push to `main` runs the simulated-shot tests, builds, and deploys `dist/index.html` to GitHub Pages (`.github/workflows/pages.yml`). Live camera mode needs that HTTPS page; the Claude Artifact version only supports Clip mode.
