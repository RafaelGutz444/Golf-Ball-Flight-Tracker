const { chromium } = require('playwright');
(async () => {
  const meta = require('/tmp/claude-0/vids/meta-live.json');
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/claude-0/vids/live.y4m'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => console.log('console:', m.text()));
  await page.goto('http://localhost:8765/index.html');
  await page.waitForFunction(() => window.__tracer.S.step === 'aim', null, { timeout: 20000 });
  const info = await page.evaluate(() => { const c = document.getElementById('cam'); return [c.videoWidth, c.videoHeight]; });
  console.log('camera', info);
  // wait for a moment in the loop where the ball sits on the ground (first 4 s), then tap it
  const tapAt = async () => page.evaluate(({ bx, by }) => {
    const v = document.getElementById('view'), cam = document.getElementById('cam');
    const r = v.getBoundingClientRect();
    const s = Math.min(v.width / cam.videoWidth, v.height / cam.videoHeight);
    const ox = (v.width - cam.videoWidth * s) / 2, oy = (v.height - cam.videoHeight * s) / 2;
    return { x: r.left + (ox + bx * s) * r.width / v.width + 2, y: r.top + (oy + by * s) * r.height / v.height - 2 };
  }, { bx: meta.ball0.x, by: meta.ball0.y });
  for (let i = 0; i < 40; i++) {
    const pt = await tapAt();
    await page.mouse.click(pt.x, pt.y);
    const b = await page.evaluate(() => window.__tracer.S.ball);
    if (b && b.contrast > 60) { console.log('ball', JSON.stringify(b)); break; }
    await page.waitForTimeout(250);
  }
  await page.click('#bGo');
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 40000) {
    const st = await page.evaluate(() => window.__tracer.S.step + ' | ' + document.getElementById('pillText').textContent);
    if (st !== last) { console.log((Date.now() - t0) + 'ms', st); last = st; }
    if (st.startsWith('result')) break;
    if (st.startsWith('flight')) await page.screenshot({ path: '/tmp/claude-0/vids/live-flight.png' });
    await page.waitForTimeout(100);
  }
  const out = await page.evaluate(() => ({ err: window.__tracer.S.error, stats: window.__tracer.S.shot && window.__tracer.S.shot.stats, clip: !!(window.__tracer.S.shot && window.__tracer.S.shot.clipUrl), impactTv: window.__tracer.S.shot && window.__tracer.S.shot.impactTv }));
  console.log(JSON.stringify(out));
  console.log('vid', await page.evaluate(() => [document.getElementById('vid').videoWidth, document.getElementById('vid').videoHeight, document.getElementById('vid').duration, document.getElementById('vid').currentTime]));
  await page.waitForTimeout(6000);
  await page.screenshot({ path: '/tmp/claude-0/vids/live-result.png' });
  await browser.close();
})();
