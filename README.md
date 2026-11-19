# Fairway Tracer

Phone web app that traces a golf ball's flight, TV style.

- `src/tracker.js` – tracking engine (no dependencies). Ball found from a tap; impact = ball disappears from its spot. The launch is found with three-frame differencing, picking the track that leaves the ball in a straight line (a club or arm traces an arc). In compressed phone video the ball is usually only visible for 0.1–0.5 s, so a simple 3D ball-flight model (drag, lift, sidespin) is fitted to those sightings and draws the rest of the flight to landing. Camera assumed level, ~68° across the long side, ~1.3 m up.
- `src/app.html` – the app: Live mode (camera, needs a normal HTTPS page) and Clip mode (record or pick a video).
- `node build.js` → `dist/index.html` (standalone, opens in Live mode) and `dist/artifact.html` (Claude Artifact body).
- `node test/run-sim.js` – 7 clean simulated shots (straight, fade, draw, punch, noisy with a bird, slice at 120 fps, dim ball).
- `node test/run-real.js` – 5 phone-like shots: motion blur, bright or cloudy sky, H.264 compression, and a camera that doesn't match the app's assumptions.
- `test/e2e-clip.js`, `test/e2e-live.js` – Playwright runs against `dist/` served on :8765 (live uses Chromium's fake camera fed with a synthetic .y4m).

Assumes the phone is on a tripod behind the golfer, looking down the target line.

## Hosting

Every push to `main` runs the simulated-shot tests, builds, and deploys `dist/index.html` to GitHub Pages (`.github/workflows/pages.yml`). Live camera mode needs that HTTPS page; the Claude Artifact version only supports Clip mode.
