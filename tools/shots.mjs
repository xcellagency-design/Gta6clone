#!/usr/bin/env node
/**
 * Takes the documentation screenshots in one live (real-time) browser session.
 *
 *   node tools/shots.mjs [outDir] [only,comma,separated]
 */
import { mkdirSync } from 'node:fs';
import { openGame, serve } from './launch.mjs';

const out = process.argv[2] ?? 'docs/screenshots';
const only = process.argv[3]?.split(',');
mkdirSync(out, { recursive: true });

const { server, url } = await serve();
const { browser, page, logs } = await openGame(url, { query: 'autostart=1&quality=medium', timeout: 180000 });
await page.waitForFunction(() => window.__undertow.state().inGame, null, { timeout: 180000 });

const cmd = (name, ...args) => page.evaluate(([n, a]) => window.__undertow.commands[n](...a), [name, args]);
const idle = async (ms = 4000) => {
  await page.waitForFunction(() => { const s = window.__undertow.app.sim.streaming.stats(); return s.queueLength === 0 && s.generating === 0 && s.byState.ready === 0; }, null, { timeout: 180000 });
  await page.waitForTimeout(ms);
};
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };
const want = (n) => !only || only.includes(n);
const face = (yaw, pitch = 0.08) => page.evaluate(([y, p]) => { const c = window.__undertow.app.sim.camera; c.yaw = y; c.pitch = p; }, [yaw, pitch]);

try {
  if (want('hud')) {
    await cmd('time', '10'); await idle(3000); await face(-Math.PI / 2);
    await page.waitForTimeout(1500);
    await shot('final_start_hud');
  }
  if (want('downtown')) {
    await cmd('time', '16.5'); await cmd('tp', '2493', '1905'); await face(Math.PI); await idle(25000);
    await face(Math.PI); await page.waitForTimeout(800);
    await shot('final_downtown_traffic');
  }
  if (want('flats')) {
    await cmd('time', '11'); await cmd('tp', '1610', '1290'); await face(0); await idle(20000);
    await face(0); await page.waitForTimeout(800);
    await shot('final_flats_pedestrians');
  }
  if (want('night')) {
    await cmd('time', '22'); await cmd('tp', '3307', '1560'); await face(Math.PI); await idle(15000);
    await face(Math.PI); await page.waitForTimeout(800);
    await shot('final_neon_mile_night');
  }
  if (want('rain')) {
    await cmd('time', '14'); await cmd('weather', 'storm'); await cmd('tp', '2105', '1700'); await face(Math.PI / 2); await idle(10000);
    await face(Math.PI / 2); await page.waitForTimeout(800);
    await shot('final_storm_wet_roads');
    await cmd('weather', 'clear');
  }
  if (want('beach')) {
    await cmd('time', '19.2'); await cmd('tp', '4520', '1500'); await face(-0.6, 0.02); await idle(8000);
    await face(-0.6, 0.02); await page.waitForTimeout(800);
    await shot('final_sol_strand_sunset');
  }
  if (want('port')) {
    await cmd('time', '8'); await cmd('tp', '1400', '3050'); await face(Math.PI * 0.75); await idle(8000);
    await face(Math.PI * 0.75); await page.waitForTimeout(800);
    await shot('final_ironhook_port');
  }
  if (want('overlay')) {
    await cmd('time', '15'); await cmd('tp', '805', '900', '0');
    await idle(3000);
    await page.evaluate(() => {
      const sim = window.__undertow.app.sim;
      const v = sim.vehicles.spawn('sports', sim.player.x, 0.2, sim.player.z + 5, 0, '#c8102e');
      v.owner = 'player';
      sim.putInVehicle(v);
      window.__undertow.overlay(true);
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(22000);
    await shot('final_streaming_overlay_driving');
    await page.keyboard.up('KeyW');
    await page.evaluate(() => window.__undertow.overlay(false));
  }
  if (want('map')) {
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(1500);
    await shot('final_map');
    await page.click('text=← Back');
  }
  if (want('decision')) {
    await page.evaluate(() => { const m = window.__undertow.app.sim.missions; m.replay([]); m.pendingDecision = m.story.getNode(); });
    await page.waitForTimeout(2500);
    await shot('final_story_decision');
    await page.evaluate(() => { const m = window.__undertow.app.sim.missions; const btn = [...document.querySelectorAll('.panel button')][0]; btn?.click(); void m; });
    await page.waitForTimeout(1500);
  }
  if (want('ending')) {
    await cmd('ending', '8');
    await page.waitForTimeout(14000);
    await shot('final_ending_cinematic');
    for (let i = 0; i < 9; i++) { await page.mouse.click(640, 300); await page.waitForTimeout(700); }
    await page.waitForTimeout(1200);
    await shot('final_ending_summary');
  }
  const st = await page.evaluate(() => window.__undertow.state());
  if (st.errors.length) console.error('page errors:', st.errors);
  if (logs.filter((l) => !l.includes('GL Driver')).length) console.log(logs.filter((l) => !l.includes('GL Driver')).slice(0, 10).join('\n'));
} finally {
  await browser.close();
  server.close();
}
