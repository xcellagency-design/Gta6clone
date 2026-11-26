#!/usr/bin/env node
/**
 * Browser benchmark: frame pacing of the real build, standing and driving. Writes
 * out/bench-browser.json. On a machine without a GPU this measures software rendering and says so.
 *
 *   node tools/bench.mjs [quality...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { openGame, serve } from './launch.mjs';

const qualities = process.argv.slice(2).length ? process.argv.slice(2) : ['low', 'medium'];
const { server, url } = await serve();
const results = [];

async function sample(page, seconds) {
  return page.evaluate((secs) => new Promise((ok) => {
    const t = [];
    let last = performance.now();
    const end = last + secs * 1000;
    const f = (now) => {
      t.push(now - last); last = now;
      if (now < end) requestAnimationFrame(f);
      else {
        t.shift();
        const s = [...t].sort((a, b) => a - b);
        const mean = t.reduce((a, b) => a + b, 0) / t.length;
        const worst1 = s.slice(Math.floor(s.length * 0.99));
        const st = window.__undertow.state();
        ok({
          frames: t.length, avgFps: +(1000 / mean).toFixed(1), onePercentLowFps: +(1000 / (worst1.reduce((a, b) => a + b, 0) / worst1.length)).toFixed(1),
          frameMsP50: +s[Math.floor(s.length / 2)].toFixed(1), frameMsP99: +s[Math.floor(s.length * 0.99)].toFixed(1), frameMsMax: +s[s.length - 1].toFixed(1),
          drawCalls: st.render.drawCalls, triangles: st.render.triangles, simStepMs: +st.stepMs.toFixed(2),
          residentCells: st.streaming.resident, lod: st.streaming.byLod, streamWorkMs: +st.streaming.frameWorkMs.toFixed(2), streamWorkPeakMs: +st.streaming.maxFrameWorkMs.toFixed(2),
          cellMemoryMB: +(st.streaming.residentBytes / 1048576).toFixed(1), cacheMB: +(st.streaming.cacheBytes / 1048576).toFixed(1),
          heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
          pedestrians: st.peds, traffic: st.traffic, speedKmh: st.vehicle ? Math.round(st.vehicle.speed * 3.6) : 0,
        });
      }
    };
    requestAnimationFrame(f);
  }), seconds);
}

for (const q of qualities) {
  const { browser, page } = await openGame(url, { query: `autostart=1&quality=${q}`, timeout: 180000 });
  await page.waitForFunction(() => window.__undertow.state().inGame, null, { timeout: 180000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  const idle = () => page.waitForFunction(() => { const s = window.__undertow.app.sim.streaming.stats(); return s.queueLength === 0 && s.generating === 0 && s.byState.ready === 0; }, null, { timeout: 180000 });
  await page.evaluate(() => window.__undertow.commands.time('13'));
  await page.evaluate(() => window.__undertow.commands.tp('2493', '1905'));
  await idle();
  await page.waitForTimeout(8000);
  const standing = await sample(page, 12);
  await page.evaluate(async () => {
    await window.__undertow.commands.tp('805', '700', '0');
    const sim = window.__undertow.app.sim;
    const v = sim.vehicles.spawn('sports', sim.player.x, 0.2, sim.player.z + 5, 0);
    v.owner = 'player';
    sim.putInVehicle(v);
  });
  await idle();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(5000);
  const driving = await sample(page, 14);
  await page.keyboard.up('KeyW');
  const latency = await page.evaluate(() => { const s = window.__undertow.state().streaming; return { avgLoadMs: Math.round(s.avgLatencyMs), lastLoadMs: Math.round(s.lastLatencyMs), avgGenerationMs: +s.avgGenerationMs.toFixed(2), loads: s.loadsCompleted, unloads: s.unloadsCompleted, cacheHits: s.cacheHits }; });
  results.push({ quality: q, gpu, viewport: '1280x720', standingDowntown: standing, drivingHighway: driving, streaming: latency });
  console.log(JSON.stringify(results[results.length - 1], null, 2));
  await browser.close();
}
server.close();
mkdirSync('out', { recursive: true });
writeFileSync('out/bench-browser.json', JSON.stringify(results, null, 2) + '\n');
