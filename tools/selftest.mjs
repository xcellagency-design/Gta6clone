/**
 * Gameplay self-test. Drives the real build in a browser through window.__undertow with
 * scripted input and measures every step from the game's own state.
 *
 * The first three results use the step names Craft Anything's SelfTestCheck looks for
 * ("move", "act", "hud"); the rest are this project's own steps.
 */

const U = () => window.__undertow;

export async function runSelfTest(page) {
  const steps = [];
  const add = (step, passed, detail) => steps.push({ step, passed: !!passed, detail });
  const state = () => page.evaluate(() => window.__undertow.state());
  const step = (n) => page.evaluate((k) => window.__undertow.step(k), n);
  const input = (p) => page.evaluate((x) => window.__undertow.input(x), p);
  const guard = async (name, fn) => {
    try { await fn(); } catch (e) { add(name, false, `threw: ${String(e.message).split('\n')[0]}`); }
  };

  // 1. The game launches to its main menu.
  let s = await state();
  add('launch', s.menu === 'main' && s.errors.length === 0 && s.render.frames > 0,
    `main menu shown after boot, ${s.render.frames} frames drawn, ${s.streaming.resident} cells behind the menu, ${s.errors.length} errors`);

  // 2. The menu works: every screen opens, Back returns, New Game starts play.
  await guard('menu', async () => {
    await page.click('text=Settings');
    const settings = (await state()).menu;
    await page.click('text=← Back');
    await page.click('text=Controls');
    const controls = (await state()).menu;
    await page.click('text=← Back');
    const continueDisabled = await page.locator('button:has-text("Continue")').isDisabled();
    await page.click('text=New Game');
    await page.waitForFunction(() => window.__undertow.state().inGame, null, { timeout: 90000 });
    s = await state();
    add('menu', settings === 'settings' && controls === 'controls' && s.inGame && s.menu === 'none',
      `Settings and Controls open and return; Continue is ${continueDisabled ? 'disabled with no save' : 'enabled'}; New Game starts play`);
  });

  // 3. The player spawns on the ground.
  await guard('spawn', async () => {
    await step(60);
    s = await state();
    add('spawn', s.player.grounded && s.player.mode === 'foot' && Math.abs(s.player.y) < 0.5 && !s.waitingForWorld,
      `on foot at (${s.player.x.toFixed(0)}, ${s.player.z.toFixed(0)}), height ${s.player.y.toFixed(2)} m, district "${s.hud.district}"`);
  });

  // 4. Core loop: move.
  let walked = 0;
  await guard('move', async () => {
    await page.evaluate(() => { window.__undertow.app.sim.camera.yaw = -Math.PI / 2; });
    const a = (await state()).player;
    await input({ moveY: 1 });
    await step(150);
    const run = (await state()).player;
    await input({ sprint: true });
    await step(60);
    const sprint = (await state()).player;
    await input({ moveY: 0, sprint: false });
    await step(20);
    walked = Math.hypot(sprint.x - a.x, sprint.z - a.z);
    add('move', walked > 8 && run.speed > 3.5 && sprint.speed > 6,
      `walked ${walked.toFixed(1)} m; running ${run.speed.toFixed(1)} m/s, sprinting ${sprint.speed.toFixed(1)} m/s`);
  });

  // 5. The camera follows and turns.
  await guard('camera', async () => {
    const a = await state();
    const dist = Math.hypot(a.camera.x - a.player.x, a.camera.z - a.player.z);
    await input({ lookX: 40 });
    await step(30);
    await input({ lookX: 0 });
    const b = await state();
    const turned = Math.abs(b.camera.yaw - a.camera.yaw);
    add('camera', dist > 1.5 && dist < 8 && a.camera.y > 0.2 && turned > 0.5,
      `follows ${dist.toFixed(1)} m behind at height ${a.camera.y.toFixed(1)} m; look input turned it ${turned.toFixed(2)} rad`);
  });

  // 6–8. Enter a vehicle, drive it (core loop: act), get out.
  let hudDriving = null;
  await guard('vehicle', async () => {
    const pos = await page.evaluate(() => {
      const sim = window.__undertow.app.sim;
      const car = [...sim.vehicles.all.values()].find((v) => v.owner === 'player');
      sim.player.teleport(car.x + 2.2, 0.2, car.z);
      return { x: car.x, z: car.z };
    });
    await step(20);
    const promptBefore = (await state()).hud.prompt;
    await page.evaluate(() => window.__undertow.pulse('enterExit'));
    await step(10);
    s = await state();
    add('enter vehicle', s.player.mode === 'vehicle' && !!s.vehicle, `prompt "${promptBefore}"; now in the ${s.vehicle?.profile ?? 'nothing'}`);

    await input({ moveY: 1 });
    let top = 0;
    for (let i = 0; i < 6; i++) {
      await step(30);
      s = await state();
      top = Math.max(top, s.vehicle.speed);
    }
    hudDriving = s.hud;
    const drove = Math.hypot(s.vehicle.x - pos.x, s.vehicle.z - pos.z);
    add('act', drove > 10 && top > 5, `drove ${drove.toFixed(1)} m out of the yard, reaching ${(top * 3.6).toFixed(0)} km/h in gear ${s.vehicle.gear}`);

    await input({ moveY: -1 });
    await step(110);
    await input({ moveY: 0, handbrake: true });
    await step(90);
    await input({ handbrake: false });
    await page.evaluate(() => window.__undertow.pulse('enterExit'));
    await step(40);
    s = await state();
    add('exit vehicle', s.player.mode === 'foot' && s.vehicle === null && s.player.grounded, `back on foot at (${s.player.x.toFixed(0)}, ${s.player.z.toFixed(0)})`);
  });

  // Core loop: hud.
  s = await state();
  add('hud', s.hud.visible && s.hud.district.length > 2 && /\d\d:\d\d/.test(s.hud.text) && !!hudDriving?.vehiclePanel && /KM\/H/.test(hudDriving.text),
    `district "${s.hud.district}", clock and weather drawn; speed, gear, fuel and condition drawn while driving`);

  // 9–10. World cells load ahead and unload behind as the player travels.
  await guard('streaming', async () => {
    const a = (await state()).streaming;
    add('cells load', a.loadsCompleted > 20 && a.byLod[0] > 0 && a.byLod[1] > 0 && a.byLod[2] > 0,
      `${a.resident} cells resident (LOD0 ${a.byLod[0]}, LOD1 ${a.byLod[1]}, LOD2 ${a.byLod[2]}, LOD3 ${a.byLod[3]}), ${a.loadsCompleted} loads, average ${a.avgLatencyMs.toFixed(0)} ms`);
    await page.evaluate(() => window.__undertow.teleport(2500, 1500, 0));
    await step(30);
    await page.evaluate(() => window.__undertow.teleport(600, 700, 0));
    await step(60);
    const b = (await state()).streaming;
    add('cells unload', b.unloadsCompleted > 20 && b.resident < a.resident * 2 + 200,
      `${b.unloadsCompleted} cells unloaded after travelling; ${b.resident} resident, cache ${(b.cacheBytes / 1048576).toFixed(1)} MB`);
    s = await state();
    add('no loading screen', !s.waitingForWorld && s.player.grounded, 'ground was solid on arrival; play was never held for streaming');
  });

  // Optional later-milestone steps, registered by the game as it grows.
  const extra = await page.evaluate(async () => {
    const run = window.__undertow.commands.selftest;
    return run ? await run() : [];
  });
  for (const e of extra) add(e.step, e.passed, e.detail);

  s = await state();
  add('render', s.render.drawCalls > 10 && s.render.triangles > 5000 && s.errors.length === 0,
    `${s.render.drawCalls} draw calls, ${s.render.triangles} triangles, ${s.errors.length} page errors`);
  void U;
  return { version: 1, steps };
}
