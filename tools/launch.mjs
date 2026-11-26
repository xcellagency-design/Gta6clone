#!/usr/bin/env node
/**
 * Launcher for the built game, implementing Craft Anything's two runtime contracts:
 *
 *   node tools/launch.mjs --screenshot <file.png> [--scene menu|spawn|downtown|night|rain|drive|beach|port]
 *   node tools/launch.mjs --self-test <file.json>
 *
 * It serves dist/ on a loopback port, opens it in headless Chromium (software WebGL when there
 * is no GPU) and either saves a picture or plays the core loop with scripted input and writes a
 * report in the self-test schema ({"version": 1, "steps": [{"step", "passed", "detail"}]}).
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const has = (name) => args.includes(name);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function serve() {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first');
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^([/\\])+/, '');
    const file = join(dist, path || 'index.html');
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

export async function openGame(url, { width = 1280, height = 720, query = 'selftest=1&quality=low', timeout = 120000 } = {}) {
  const require = createRequire(import.meta.url);
  let playwright;
  try { playwright = require('playwright'); } catch { playwright = createRequire('/opt/node-tools/')('playwright'); }
  const browser = await playwright.chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url + '?' + query);
  await page.waitForFunction(() => window.__undertow?.ready(), null, { timeout });
  return { browser, page, logs };
}

const SCENES = {
  menu: null,
  spawn: { x: 1034, z: 2838, heading: -Math.PI / 2, hour: 10 },
  downtown: { x: 2493, z: 1905, heading: Math.PI, hour: 16.5, warm: 900 },
  night: { x: 3307, z: 1560, heading: Math.PI, hour: 22, weather: 'clear', warm: 600 },
  rain: { x: 2105, z: 1700, heading: Math.PI / 2, hour: 14, weather: 'rain' },
  beach: { x: 4505, z: 1500, heading: 0, hour: 18.6 },
  port: { x: 1400, z: 3050, heading: Math.PI / 2, hour: 8 },
  suburbs: { x: 1000, z: 900, heading: 0, hour: 12 },
  flats: { x: 1700, z: 1210, heading: Math.PI / 2, hour: 11 },
  drive: { x: 2400, z: 1810, heading: Math.PI / 2, hour: 17.5, drive: true },
};

async function settle(page, frames = 30) {
  await page.evaluate((n) => new Promise((ok) => { let i = 0; const f = () => (++i >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), frames);
}

async function screenshot(file) {
  const { server, url } = await serve();
  const sceneName = opt('--scene') ?? 'spawn';
  const scene = SCENES[sceneName];
  const quality = opt('--quality') ?? 'medium';
  const { browser, page, logs } = await openGame(url, { query: `selftest=1&quality=${quality}`, width: Number(opt('--width') ?? 1280), height: Number(opt('--height') ?? 720) });
  try {
    if (scene) {
      await page.evaluate(async (s) => {
        const u = window.__undertow;
        await u.startGame();
        if (s.hour !== undefined) u.setTime(s.hour);
        if (s.weather) u.setWeather(s.weather);
        await u.teleport(s.x, s.z, s.heading);
        u.step(s.warm ?? 30);
        if (s.drive) {
          const car = u.commands.spawn ? null : null;
          void car;
          const sim = u.app.sim;
          const v = sim.vehicles.spawn('sports', s.x + 3, 0.15, s.z, s.heading, '#c8102e');
          v.owner = 'player';
          u.step(20);
          u.pulse('enterExit');
          u.step(5);
          u.input({ moveY: 1 });
          u.step(240);
        }
      }, scene);
      if (has('--overlay')) await page.evaluate(() => window.__undertow.overlay(true));
    }
    // Let streaming finish and the cross-fades complete, then draw the frames the contract asks for.
    await page.waitForFunction(() => {
      const s = window.__undertow.app.sim.streaming.stats();
      return s.queueLength === 0 && s.generating === 0 && s.byState.ready === 0;
    }, null, { timeout: 120000 });
    await settle(page, 120);
    mkdirSync(dirname(resolve(file)), { recursive: true });
    await page.screenshot({ path: file });
    const st = await page.evaluate(() => window.__undertow.state());
    console.log(`saved ${file}  scene=${sceneName}  drawCalls=${st.render.drawCalls}  triangles=${st.render.triangles}  cells=${st.streaming.resident}`);
    if (logs.length) console.log(logs.slice(0, 12).join('\n'));
    if (st.errors.length) { console.error('page errors:', st.errors); process.exitCode = 1; }
  } finally {
    await browser.close();
    server.close();
  }
}

async function selfTest(file) {
  const { runSelfTest } = await import('./selftest.mjs');
  const { server, url } = await serve();
  const { browser, page, logs } = await openGame(url);
  let report;
  try {
    report = await runSelfTest(page);
  } catch (e) {
    report = { version: 1, steps: [{ step: 'move', passed: false, detail: `self-test crashed: ${e.message}` }] };
  } finally {
    await browser.close();
    server.close();
  }
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  for (const s of report.steps) console.log(`${s.passed ? 'PASS' : 'FAIL'}  ${s.step.padEnd(22)} ${s.detail}`);
  if (logs.length) console.log('\nbrowser log:\n' + logs.slice(0, 20).join('\n'));
  const failed = report.steps.filter((s) => !s.passed).length;
  console.log(`\n${report.steps.length - failed}/${report.steps.length} steps passed → ${file}`);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shot = opt('--screenshot'), test = opt('--self-test');
  if (shot) await screenshot(shot);
  else if (test) await selfTest(test);
  else { console.error('usage: launch.mjs --screenshot <file.png> [--scene name] | --self-test <file.json>'); process.exit(2); }
}
