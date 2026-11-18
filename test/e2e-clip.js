const { chromium } = require('playwright');
(async () => {
  const meta = require('/tmp/claude-0/vids/meta.json');
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('console:', m.text()));
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8765/artifact-test.html');
  await page.setInputFiles('#filePick', process.argv[2] || '/tmp/claude-0/vids/shot60.webm');
  await page.waitForFunction(() => window.__tracer.S.step === 'aim', null, { timeout: 20000 });
  // tap the ball
  const pt = await page.evaluate(({ bx, by }) => {
    const v = document.getElementById('view'), vid = document.getElementById('vid');
    const r = v.getBoundingClientRect();
    const s = Math.min(v.width / vid.videoWidth, v.height / vid.videoHeight);
    const ox = (v.width - vid.videoWidth * s) / 2, oy = (v.height - vid.videoHeight * s) / 2;
    return { x: r.left + (ox + bx * s) * r.width / v.width + 3, y: r.top + (oy + by * s) * r.height / v.height - 2 };
  }, { bx: meta.ball0.x, by: meta.ball0.y });
  await page.mouse.click(pt.x, pt.y);
  const ball = await page.evaluate(() => window.__tracer.S.ball);
  console.log('ball', JSON.stringify(ball));
  await page.screenshot({ path: '/tmp/claude-0/vids/aim.png' });
  const t0 = Date.now();
  await page.click('#bGo');
  await page.waitForTimeout(300); await page.waitForFunction(() => ['result', 'aim'].includes(window.__tracer.S.step), null, { timeout: 120000 });
  const out = await page.evaluate(() => ({ step: window.__tracer.S.step, err: window.__tracer.S.error, stats: window.__tracer.S.shot && window.__tracer.S.shot.stats, n: window.__tracer.S.shot && window.__tracer.S.shot.points.length, end: window.__tracer.S.shot && window.__tracer.S.shot.endTv }));
  console.log('took', Date.now() - t0, 'ms', JSON.stringify(out));
  await page.waitForTimeout(3500);
  await page.screenshot({ path: '/tmp/claude-0/vids/result-mid.png' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/claude-0/vids/result.png' });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#bSave')]);
  const path = '/tmp/claude-0/vids/' + dl.suggestedFilename(); await dl.saveAs(path);
  console.log('saved', path, require('fs').statSync(path).size, 'bytes');
  await browser.close();
})();
