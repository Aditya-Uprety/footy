#!/usr/bin/env node
// Dev-only visual check for machines where the browser pane has no WebGL.
// Drives headless Chrome (SwiftShader WebGL) over the DevTools protocol in real
// time, runs optional steps, saves a screenshot and prints console output.
//
// Usage:
//   node scripts/webgl-shot.mjs <url> <out.png> [steps...]
// Steps (run in order):
//   wait:<ms>                 sleep
//   eval:<js>                 evaluate an expression, print the JSON result
//   drag:x1,y1,x2,y2          left-drag with the mouse
//   rdrag:x1,y1,x2,y2         right-drag with the mouse
//   wheel:x,y,dy              mouse wheel (dy > 0 scrolls down / zooms out)
//   click:x,y                 left click
//   sclick:x,y                Shift + left click
//   rclick:x,y                right click
//   move:x,y                  move the mouse (hover)
//   key:<Key>                 key press (e.g. key:4, key:Tab, key:Enter)
//   js<step>:<expr>           any mouse step with coordinates from a JS expression
//                             returning [x, y] / [x1, y1, x2, y2] or {x, y}
//                             (e.g. jsclick:__placement.screenOf(-20, 5))
//   shot:<file.png>           extra screenshot mid-sequence
// Env: CHROME (binary), SIZE (default 1280x720).
// Exit code 1 if the page logged an error or threw.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, ...steps] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node scripts/webgl-shot.mjs <url> <out.png> [steps...]');
  process.exit(2);
}
const [W, H] = (process.env.SIZE ?? '1280x720').split('x').map(Number);
const chromeBin = process.env.CHROME ?? 'google-chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'footy-chrome-'));

const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errors = 0;

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome DevTools endpoint did not come up');
}

async function main() {
  const ws = new WebSocket(await connect());
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const p = msg.params;
      const text = p.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (p.type === 'error') errors++;
      if (!/^\[vite\]/.test(text)) console.log(`[console.${p.type}] ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors++;
      const d = msg.params.exceptionDetails;
      console.log(`[exception] ${d.exception?.description ?? d.text}`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') {
        errors++;
        console.log(`[log.error] ${e.text} ${e.url ?? ''}`);
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(2500);

  const mouse = (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });
  const drag = async (x1, y1, x2, y2, button) => {
    const buttons = button === 'left' ? 1 : 2;
    await mouse('mouseMoved', x1, y1);
    await mouse('mousePressed', x1, y1, { button, buttons, clickCount: 1 });
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      await mouse('mouseMoved', x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, { button, buttons });
      await sleep(16);
    }
    await mouse('mouseReleased', x2, y2, { button, buttons, clickCount: 1 });
  };
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`[shot] ${file}`);
  };

  for (const raw of steps) {
    let step = raw;
    if (/^js(click|sclick|rclick|move|drag|rdrag):/.test(step)) {
      const j = step.indexOf(':');
      const r = await send('Runtime.evaluate', { expression: step.slice(j + 1), returnByValue: true });
      const v = r.result.value;
      const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y] : [];
      step = `${step.slice(2, j)}:${arr.map((n) => Math.round(n)).join(',')}`;
    }
    const i = step.indexOf(':');
    const kind = step.slice(0, i);
    const arg = step.slice(i + 1);
    const nums = () => arg.split(',').map(Number);
    if (kind === 'wait') await sleep(Number(arg));
    else if (kind === 'eval') {
      const r = await send('Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true });
      console.log(`[eval] ${JSON.stringify(r.result.value ?? r.result.description ?? null)}`);
    } else if (kind === 'drag') await drag(...nums(), 'left');
    else if (kind === 'rdrag') await drag(...nums(), 'right');
    else if (kind === 'wheel') {
      const [x, y, dy] = nums();
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
    } else if (kind === 'click' || kind === 'sclick') {
      const [x, y] = nums();
      const modifiers = kind === 'sclick' ? 8 : 0;
      await mouse('mouseMoved', x, y, { modifiers });
      await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1, modifiers });
      await mouse('mouseReleased', x, y, { button: 'left', buttons: 1, clickCount: 1, modifiers });
    } else if (kind === 'rclick') {
      const [x, y] = nums();
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y, { button: 'right', buttons: 2, clickCount: 1 });
      await mouse('mouseReleased', x, y, { button: 'right', buttons: 2, clickCount: 1 });
    } else if (kind === 'move') {
      const [x, y] = nums();
      await mouse('mouseMoved', x, y);
    } else if (kind === 'key') {
      const code = /^[0-9]$/.test(arg) ? `Digit${arg}` : /^[a-z]$/i.test(arg) ? `Key${arg.toUpperCase()}` : arg;
      const text = arg.length === 1 ? arg : undefined;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: arg, code, text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: arg, code });
    } else if (kind === 'shot') await shot(arg);
    else throw new Error(`unknown step: ${step}`);
  }
  await sleep(300);
  await shot(out);
  ws.close();
}

try {
  await main();
} catch (e) {
  console.error(e);
  errors++;
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
console.log(errors ? `[result] ${errors} error(s)` : '[result] no console errors');
process.exit(errors ? 1 : 0);
