import { QUALITY } from '../../src/core/config';
import { GameSim } from '../../src/core/GameSim';
import { ScriptedInput } from '../../src/core/Input';
import { InlineExecutor } from '../../src/streaming/executors';

/** A complete headless game: real physics, real streaming, scripted input. */
export async function makeSim(): Promise<{ sim: GameSim; input: ScriptedInput }> {
  const input = new ScriptedInput();
  const sim = await GameSim.create({ executor: new InlineExecutor(7), input, quality: QUALITY.low, seed: 7 });
  await sim.newGame();
  return { sim, input };
}

/** Advance the simulation, streaming once per simulated frame as the app does. */
export function run(sim: GameSim, seconds: number, each?: () => void): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    sim.streamTick(1 / 60, 1e9);
    sim.step();
    each?.();
  }
}
