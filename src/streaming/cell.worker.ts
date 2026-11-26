/// <reference lib="webworker" />
import { cellTransferables } from './CellData';
import { generateCell } from './CellGenerator';

/** Background generation: the main thread never builds world geometry during play. */
self.onmessage = (e: MessageEvent<{ id: number; cx: number; cz: number; lod: number; seed: number }>) => {
  const { id, cx, cz, lod, seed } = e.data;
  const cell = generateCell(cx, cz, lod, seed);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, cell }, cellTransferables(cell));
};
