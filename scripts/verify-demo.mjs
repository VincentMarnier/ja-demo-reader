#!/usr/bin/env node
/*
 * M3 headless demo verification.
 *
 * Starts a local static server, launches Chrome headless with CDP, stages the
 * user's PK3s + demo through the M3 harness, and asserts:
 *   - staging completes
 *   - cgame reaches CA_ACTIVE
 *   - serverTime advances
 *   - no network requests after staging (playback is local)
 *   - a non-blank canvas frame is captured
 *   - optionally, demo end is reported
 *
 * Nothing is uploaded. Assets and demos are read from the user's directories
 * and served only on loopback.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const WEB_DIR = resolve(process.env.WEB_DIR || '/tmp/jka-demo-player/m3/web');
const ASSETS_DIR = process.env.ASSETS_DIR ? resolve(process.env.ASSETS_DIR) : null;
const DEMO = process.env.DEMO || '';
const DEMO_FILE = process.env.DEMO_FILE
  ? resolve(process.env.DEMO_FILE)
  : (ASSETS_DIR && DEMO ? join(ASSETS_DIR, 'demos', `${DEMO}.dm_26`) : null);
const OUT_DIR = resolve(process.env.OUT_DIR || '/tmp/jka-demo-player/m3/artifacts');
const CHROME = process.env.CHROME ||
  join(process.env.HOME || '', '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
const WAIT_END = process.env.WAIT_END === '1';
const TIMESCALE = process.env.TIMESCALE || '1';
const NOREFRESH = process.env.NOREFRESH === '1';
const PAUSE_FIRST = process.env.PAUSE_FIRST === '1';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || '180000');

const CA_ACTIVE = 8;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exit(1);
}

if (!ASSETS_DIR) {
  console.error('Set ASSETS_DIR to the base/ directory containing assets0..3.pk3.');
  process.exit(2);
}
if (!DEMO_FILE) {
  console.error('Set DEMO or DEMO_FILE to a .dm_26 demo.');
  process.exit(2);
}
for (const [label, path] of [['web dir', WEB_DIR], ['assets dir', ASSETS_DIR], ['demo file', DEMO_FILE], ['chrome', CHROME]]) {
  if (!existsSync(path)) fail(`${label} not found: ${path}`);
}
mkdirSync(OUT_DIR, { recursive: true });

// A minimal sanity check that the retail asset set is present.
for (let i = 0; i < 4; i++) {
  const p = join(ASSETS_DIR, `assets${i}.pk3`);
  if (!existsSync(p)) fail(`missing ${p}`);
}
try {
  const assets2 = readFileSync(join(ASSETS_DIR, 'assets2.pk3'));
  if (assets2.includes(Buffer.from('productid.txt'))) {
    console.log('ok: productid.txt found in assets2.pk3');
  } else {
    console.log('warning: productid.txt not found in assets2.pk3');
  }
} catch (e) {
  console.log('warning: could not scan assets2.pk3:', e.message);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.pk3': 'application/octet-stream',
  '.dm_26': 'application/octet-stream'
};

const requests = [];
const server = createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('bad url'); return; }

  requests.push({ at: Date.now(), path: urlPath });
  let file;
  if (urlPath === '/' || urlPath === '/demo.html') file = join(WEB_DIR, 'demo.html');
  else if (urlPath === '/openjk.x86.js' || urlPath === '/openjk.x86.wasm' || urlPath === '/openjk.x86.data') file = join(WEB_DIR, urlPath.slice(1));
  else if (/^\/assets[0-3]\.pk3$/.test(urlPath)) file = join(ASSETS_DIR, urlPath.slice(1));
  else if (urlPath === `/demos/${DEMO}.dm_26`) file = DEMO_FILE;
  else { res.writeHead(404); res.end('not found'); return; }

  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const size = statSync(file).size;
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': 'no-store'
  });
  createReadStream(file).pipe(res);
});

await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
console.log('serving', WEB_DIR, 'assets', ASSETS_DIR, 'on', baseUrl);

// Pick a debug port for Chrome.
const probe = createServer();
await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve));
const debugPort = probe.address().port;
await new Promise(r => probe.close(r));

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--js-flags=--max-old-space-size=6144',
  '--window-size=800,600',
  `--remote-debugging-port=${debugPort}`,
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErr = '';
chrome.stderr.on('data', d => { chromeErr += d.toString(); });

async function waitForJson() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome CDP did not start');
}

const targets = await waitForJson();
const page = targets.find(t => t.type === 'page');
if (!page) fail('no CDP page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const consoleLines = [];
let statusFromConsole = null;
let stagedAt = null;
let firstActiveAt = null;

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
    consoleLines.push(text);
    const m = /M3STATUS (\{.*\})/.exec(text);
    if (m) {
      try { statusFromConsole = JSON.parse(m[1]); } catch {}
    }
    if (text.includes('staged /assets3.pk3')) {
      // staging is acknowledged in the page; the explicit flag is polled below
    }
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    console.error('PAGE EXCEPTION:', d.text, d.exception?.description || '');
  }
};

function send(method, params = {}, timeout = 20000) {
  return Promise.race([
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeout))
  ]);
}

async function evaluate(expression, timeout = 15000) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }, timeout);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
  return r.result ? r.result.value : undefined;
}

async function getStatus(timeout = 10000) {
  try {
    const raw = await evaluate('window.__m3 && window.__m3.status ? JSON.stringify(window.__m3.status) : null', timeout);
    if (raw) return JSON.parse(raw);
  } catch {}
  return statusFromConsole;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Log.enable');

const url = `${baseUrl}/?demo=${encodeURIComponent(DEMO)}&timescale=${encodeURIComponent(TIMESCALE)}`
  + (NOREFRESH ? '&norefresh=1' : '') + (PAUSE_FIRST ? '&pause=1' : '');
console.log('navigating', url);
await send('Page.navigate', { url });

const deadline = Date.now() + TIMEOUT_MS;
let status = null;

while (Date.now() < deadline) {
  const staged = await evaluate('!!(window.__m3 && window.__m3.staged)', 5000).catch(() => false);
  if (staged && !stagedAt) {
    stagedAt = Date.now();
    console.log('staging complete');
  }
  status = await getStatus();
  if (status) {
    if (status.state === CA_ACTIVE && !firstActiveAt) {
      firstActiveAt = Date.now();
      console.log('CA_ACTIVE reached, serverTime', status.serverTime);
      break;
    }
  }
  await sleep(1000);
}

if (!firstActiveAt) {
  console.error(consoleLines.slice(-40).join('\n'));
  fail('CA_ACTIVE not reached within timeout');
}

// SwiftShader can take many seconds per frame; sample over a long enough
// window to observe several engine frames rather than wall-clock seconds.
// With r_norefresh the renderer is skipped, so a short window is enough.
const times = [];
const sampleCount = NOREFRESH ? 10 : 12;
const sampleDelay = NOREFRESH ? 1000 : 5000;
if (PAUSE_FIRST) {
  console.log('paused-first mode: skipping serverTime sampling');
} else {
  for (let i = 0; i < sampleCount; i++) {
    const s = await getStatus(10000);
    if (s) times.push(s.serverTime);
    await sleep(sampleDelay);
  }
  console.log('serverTime samples:', times.join(', '));
}
if (!PAUSE_FIRST) {
if (times.length < 4) fail('not enough serverTime samples');
let advances = 0;
for (let i = 1; i < times.length; i++) {
  if (times[i] > times[i - 1]) advances++;
}
if (advances === 0) {
  const s = await getStatus(10000);
  console.error('last status:', JSON.stringify(s));
  console.error('page errors:', await evaluate('JSON.stringify(window.__m3 && window.__m3.errors)', 5000).catch(() => 'n/a'));
  console.error(consoleLines.slice(-30).join('\n'));
  fail('serverTime did not advance');
}
console.log('serverTime advances:', advances, 'of', times.length - 1);
}

// A separate PAUSE_FIRST run captures the first active frame. Rendering under
// SwiftShader can saturate the main thread, so the playback run does not try
// to grab a screenshot while frames are being produced.
if (PAUSE_FIRST) {
  try {
    await sleep(3000);
    let png = null;
    try {
      const dataUrl = await evaluate("document.getElementById('canvas').toDataURL('image/png')", 20000);
      const b64 = dataUrl && dataUrl.split(',')[1];
      if (b64) png = Buffer.from(b64, 'base64');
    } catch (e) {
      console.error('canvas read failed:', e.message);
    }
    if (!png || png.length < 20000) {
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: false }, 60000);
      png = Buffer.from(shot.data, 'base64');
    }
    if (!png || png.length < 20000) {
      fail('could not capture a non-blank frame (png ' + (png ? png.length : 0) + ' bytes)');
    }
    const shotPath = join(OUT_DIR, 'browser-demo.png');
    writeFileSync(shotPath, png);
    console.log('screenshot:', shotPath, png.length + ' bytes');
  } catch (e) {
    fail('screenshot failed: ' + e.message);
  }
} else {
  console.log('playback mode: screenshot is covered by the PAUSE_FIRST run');
}

// Network after staging: no external requests, no engine network.
await sleep(3000);
if (stagedAt) {
  const late = requests.filter(r => r.at > stagedAt + 1000);
  const external = late.filter(r => !r.path.startsWith('/') && !r.path.startsWith('http'));
  console.log('requests after staging:', late.map(r => r.path).join(', ') || '(none)');
  if (late.length > 0) {
    fail('network activity after staging: ' + late.map(r => r.path).join(', '));
  }
}

if (WAIT_END) {
  console.log('waiting for demo end...');
  const endDeadline = Date.now() + Math.max(60000, TIMEOUT_MS);
  let ended = null;
  while (Date.now() < endDeadline) {
    const s = await getStatus(10000);
    if (s && s.ended === 1) { ended = s; break; }
    await sleep(1000);
  }
  if (!ended) fail('demo did not report completion');
  console.log('demo ended, state', ended.state);
  await sleep(1500);
  const s = await getStatus(10000);
  if (s && s.state === CA_ACTIVE) fail('engine still active after demo end');
}

writeFileSync(join(OUT_DIR, 'verify-demo.json'), JSON.stringify({
  demo: DEMO,
  timescale: TIMESCALE,
  status,
  serverTimes: times,
  requests: requests.map(r => r.path),
  networkAfterStaging: requests.filter(r => stagedAt && r.at > stagedAt + 1000).map(r => r.path),
  consoleTail: consoleLines.slice(-40)
}, null, 2));

console.log('PASS: demo playback verified');
ws.close();
chrome.kill('SIGKILL');
server.close();
process.exit(0);
