// Builds two outputs from src/: dist/artifact.html (page body for Claude Artifacts)
// and dist/index.html (standalone page for hosting, opens in Live mode).
const fs = require('fs');
const tracker = fs.readFileSync(__dirname + '/src/tracker.js', 'utf8');
const app = fs.readFileSync(__dirname + '/src/app.html', 'utf8').replace('/*TRACKER*/', () => tracker);
fs.mkdirSync(__dirname + '/dist', { recursive: true });
fs.writeFileSync(__dirname + '/dist/artifact.html', app);
const standalone = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0b100e">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box}body{margin:0}[hidden]{display:none!important}</style>
<script>window.__TRACER_DEFAULT='live'</script>
</head><body>
${app}
</body></html>
`;
fs.writeFileSync(__dirname + '/dist/index.html', standalone);
console.log('built', app.length, 'bytes');
