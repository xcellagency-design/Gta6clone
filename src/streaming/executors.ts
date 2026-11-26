import type { CellData } from './CellData';
import { generateCell } from './CellGenerator';
import type { CellExecutor } from './StreamingManager';

/** Generates on the calling thread. For Node tests, and as a fallback when workers fail. */
export class InlineExecutor implements CellExecutor {
  private used = 0;
  generated = 0;
  constructor(private seed: number, private perFrame = Infinity) {}
  beginFrame(): void {
    this.used = 0;
  }
  available(): number {
    return this.perFrame - this.used;
  }
  request(cx: number, cz: number, lod: number, done: (data: CellData) => void): void {
    this.used++;
    this.generated++;
    done(generateCell(cx, cz, lod, this.seed));
  }
}

/** Generates after a delay, out of order, to exercise the asynchronous paths in tests. */
export class DeferredExecutor implements CellExecutor {
  private queue: { run: () => void; due: number }[] = [];
  private tick = 0;
  constructor(private seed: number, private slots = 3, private delayTicks = 2) {}
  available(): number {
    return this.slots - this.queue.length;
  }
  request(cx: number, cz: number, lod: number, done: (data: CellData) => void): void {
    this.queue.push({ run: () => done(generateCell(cx, cz, lod, this.seed)), due: this.tick + this.delayTicks });
  }
  /** Deliver finished jobs. Call once per simulated frame. */
  pump(): void {
    this.tick++;
    const due = this.queue.filter((j) => j.due <= this.tick);
    this.queue = this.queue.filter((j) => j.due > this.tick);
    for (const j of due) j.run();
  }
}

interface Job { id: number; cx: number; cz: number; lod: number; done: (data: CellData) => void }

/** A pool of Web Workers running the generator. Results come back as transferred typed arrays. */
export class WorkerExecutor implements CellExecutor {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private jobs = new Map<number, Job>();
  private nextId = 1;
  failed = false;

  constructor(private seed: number, count: number) {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./cell.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; cell: CellData }>) => {
        const job = this.jobs.get(e.data.id);
        this.jobs.delete(e.data.id);
        this.idle.push(w);
        job?.done(e.data.cell);
      };
      w.onerror = (e) => {
        console.error('cell worker failed', e.message);
        this.failed = true;
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  available(): number {
    return this.idle.length;
  }

  request(cx: number, cz: number, lod: number, done: (data: CellData) => void): void {
    const w = this.idle.pop();
    if (!w) throw new Error('no idle worker');
    const id = this.nextId++;
    this.jobs.set(id, { id, cx, cz, lod, done });
    w.postMessage({ id, cx, cz, lod, seed: this.seed });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}
