import type { EngineFile, EngineState, JobStatus } from '@shared/contracts/engine';
import { ENGINE_PROTOCOL_VERSION } from '@shared/contracts/engine';
import type { EngineInstance, EngineLauncher } from './engine-process';

/**
 * In-process implementation of engine protocol v1 with simulated transfers (02-protokol-silnika.md, FakeEngine).
 * Used by service tests, by `npm run dev` without a built engine (ADRENALINE_FAKE_ENGINE=1) and by the smoke test.
 * Never enabled in the installed app.
 */
export interface FakeEngineOptions {
  /** Bytes per second per downloading job. */
  rate?: number;
  uploadRate?: number;
  tickMs?: number;
  metadataDelayMs?: number;
  files?: (name: string) => Omit<EngineFile, 'index'>[];
  peers?: number;
}

interface StoredJob {
  name: string;
  infoHashV1: string;
  files: EngineFile[];
  hasMetadata: boolean;
  priorities: number[];
  done: number[];
  uploaded: number;
}

interface LiveJob {
  id: string;
  savePath: string;
  state: EngineState;
  reason?: string;
  error?: { code: string; message: string };
  hasSelection: boolean;
  paused: boolean;
  stopped: boolean;
  seedRatio: number | null;
  seedMinutes: number | null;
  seedingMs: number;
  checkingMs: number;
  lastState?: string;
  lastReason?: string;
  completedFiles: Set<number>;
  metadataAt: number | null;
  dirty: boolean;
}

const MiB = 1024 * 1024;

function defaultFiles(name: string): Omit<EngineFile, 'index'>[] {
  return [
    { path: `${name}/${name}.mkv`, size: 700 * MiB, pad: false },
    { path: `${name}/Sample/sample.mkv`, size: 20 * MiB, pad: false },
    { path: `${name}/${name}.nfo`, size: 2048, pad: false },
  ];
}

function parseMagnet(magnet: string): { hash: string; name: string } | null {
  if (!magnet.startsWith('magnet:?')) return null;
  const params = new URLSearchParams(magnet.slice('magnet:?'.length));
  const xt = params.getAll('xt').find((x) => x.toLowerCase().startsWith('urn:btih:'));
  if (!xt) return null;
  return { hash: xt.slice('urn:btih:'.length).toLowerCase(), name: params.get('dn') ?? 'Fake Release' };
}

export class FakeEngine {
  /** Survives "restarts" like resume files in the engine data dir. */
  private readonly store = new Map<string, StoredJob>();
  private current: FakeEngineProcess | null = null;
  launches = 0;

  constructor(readonly options: FakeEngineOptions = {}) {}

  readonly launch: EngineLauncher = () => {
    this.launches += 1;
    const proc = new FakeEngineProcess(this.store, this.options);
    this.current = proc;
    return proc.instance;
  };

  /** Simulates a crash (process killed without saving). */
  crash(): void {
    this.current?.close();
  }

  /** Injects a disk-full error for one job. */
  diskFull(jobId: string): void {
    this.current?.fileError(jobId, 'disk_full', 'DISK_FULL');
  }

  /** Ignores all requests from now on (hung process). */
  hang(): void {
    if (this.current) this.current.hung = true;
  }

  storedJob(jobId: string): StoredJob | undefined {
    return this.store.get(jobId);
  }

  get running(): FakeEngineProcess | null {
    return this.current;
  }
}

export class FakeEngineProcess {
  private seq = 0;
  private closed = false;
  private readonly lineListeners: ((line: string) => void)[] = [];
  private readonly closeListeners: (() => void)[] = [];
  private readonly jobs = new Map<string, LiveJob>();
  private timer: NodeJS.Timeout | null = null;
  private downloadLimit = 0;
  private lastTick = Date.now();
  hung = false;
  readonly instance: EngineInstance;

  constructor(
    private readonly store: Map<string, StoredJob>,
    private readonly opts: FakeEngineOptions,
  ) {
    this.instance = {
      transport: {
        write: (line) => this.receive(line),
        onLine: (l) => void this.lineListeners.push(l),
        onClose: (l) => void this.closeListeners.push(l),
      },
      kill: () => this.close(),
    };
    queueMicrotask(() =>
      this.event('ready', { engineVersion: 'fake', protocol: ENGINE_PROTOCOL_VERSION, libtorrent: 'fake' }),
    );
    this.timer = setInterval(() => this.tick(), opts.tickMs ?? 500);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const l of this.closeListeners) l();
  }

  private send(obj: unknown) {
    if (this.closed) return;
    const line = JSON.stringify(obj);
    queueMicrotask(() => {
      if (!this.closed) for (const l of this.lineListeners) l(line);
    });
  }

  private event(name: string, data: unknown) {
    this.send({ v: 1, event: name, seq: ++this.seq, data });
  }

  private ok(id: string, result: unknown) {
    this.send({ v: 1, id, ok: true, result });
  }

  private fail(id: string, code: string, message: string) {
    this.send({ v: 1, id, ok: false, error: { code, message } });
  }

  private receive(line: string) {
    if (this.closed || this.hung) return;
    let req: { id: string; op: string; jobId?: string; args?: Record<string, unknown> };
    try {
      req = JSON.parse(line) as typeof req;
    } catch {
      return;
    }
    try {
      this.handle(req.id, req.op, req.jobId, req.args ?? {});
    } catch (error) {
      const e = error as { code?: string; message?: string };
      this.fail(req.id, e.code ?? 'INTERNAL', e.message ?? 'error');
    }
  }

  private job(jobId: string | undefined): LiveJob {
    const j = jobId ? this.jobs.get(jobId) : undefined;
    if (!j) throw Object.assign(new Error('unknown job'), { code: 'JOB_NOT_FOUND' });
    return j;
  }

  private stored(j: LiveJob): StoredJob {
    const s = this.store.get(j.id);
    if (!s) throw Object.assign(new Error('missing store'), { code: 'INTERNAL' });
    return s;
  }

  private handle(id: string, op: string, jobId: string | undefined, args: Record<string, unknown>) {
    switch (op) {
      case 'hello':
        return this.ok(id, {
          protocol: ENGINE_PROTOCOL_VERSION,
          engineVersion: 'fake',
          libtorrent: 'fake',
          features: ['v2', 'resume', 'selectFiles', 'seedLimits'],
        });
      case 'ping':
        return this.ok(id, { now: Date.now() });
      case 'add':
        return this.add(id, jobId, args);
      case 'selectFiles': {
        const j = this.job(jobId);
        const s = this.stored(j);
        if (!s.hasMetadata) throw Object.assign(new Error('no metadata'), { code: 'BAD_REQUEST' });
        const files = (args['files'] as { index: number; priority: number }[]) ?? [];
        s.priorities = s.files.map(() => 0);
        for (const f of files) {
          if (f.index < 0 || f.index >= s.files.length)
            throw Object.assign(new Error('range'), { code: 'BAD_REQUEST' });
          s.priorities[f.index] = f.priority;
        }
        j.hasSelection = true;
        j.dirty = true;
        this.ok(id, { ok: true });
        return this.updateState(j);
      }
      case 'files': {
        const s = this.stored(this.job(jobId));
        return this.ok(id, { files: s.hasMetadata ? s.files : [] });
      }
      case 'pause': {
        const j = this.job(jobId);
        j.paused = true;
        j.stopped = false;
        j.reason = 'user';
        setTimeout(() => {
          this.updateState(j);
          this.ok(id, { state: 'paused' });
          this.event('resumeSaved', { jobId: j.id });
        }, 20);
        return;
      }
      case 'resume': {
        const j = this.job(jobId);
        j.paused = false;
        j.stopped = false;
        delete j.reason;
        delete j.error;
        this.ok(id, { state: this.computeState(j, true).state });
        return this.updateState(j);
      }
      case 'remove': {
        const j = this.job(jobId);
        this.jobs.delete(j.id);
        this.store.delete(j.id);
        return this.ok(id, { ok: true });
      }
      case 'recheck': {
        const j = this.job(jobId);
        j.checkingMs = 300;
        this.ok(id, { ok: true });
        return this.updateState(j);
      }
      case 'setLimits':
        this.downloadLimit = Number(args['downloadBps'] ?? 0);
        return this.ok(id, { ok: true });
      case 'setSeedPolicy': {
        const j = this.job(jobId);
        j.seedRatio = typeof args['ratio'] === 'number' ? args['ratio'] : null;
        j.seedMinutes = typeof args['minutes'] === 'number' ? args['minutes'] : null;
        return this.ok(id, { ok: true });
      }
      case 'snapshot':
        return this.ok(id, { jobs: [...this.jobs.values()].map((j) => this.status(j)), seq: this.seq });
      case 'shutdown':
        this.ok(id, { ok: true });
        setTimeout(() => this.close(), 5);
        return;
      default:
        throw Object.assign(new Error(`unknown op ${op}`), { code: 'UNKNOWN_OP' });
    }
  }

  private add(id: string, jobId: string | undefined, args: Record<string, unknown>) {
    if (!jobId) throw Object.assign(new Error('jobId'), { code: 'BAD_REQUEST' });
    const magnet = typeof args['magnet'] === 'string' ? args['magnet'] : null;
    const torrent = typeof args['torrentBase64'] === 'string' ? args['torrentBase64'] : null;
    let hash: string;
    let name: string;
    if (magnet) {
      const m = parseMagnet(magnet);
      if (!m) throw Object.assign(new Error('bad magnet'), { code: 'INVALID_MAGNET' });
      ({ hash, name } = m);
    } else if (torrent) {
      // Fake .torrent: base64 of JSON {"name": "...", "infoHash": "..."} (tests only).
      try {
        const spec = JSON.parse(Buffer.from(torrent, 'base64').toString('utf8')) as { name: string; infoHash: string };
        hash = spec.infoHash;
        name = spec.name;
      } catch {
        throw Object.assign(new Error('bad torrent'), { code: 'INVALID_TORRENT' });
      }
    } else {
      throw Object.assign(new Error('magnet or torrent'), { code: 'BAD_REQUEST' });
    }
    const existing = this.jobs.get(jobId);
    if (existing) {
      const s = this.stored(existing);
      if (s.infoHashV1 !== hash) throw Object.assign(new Error('different'), { code: 'JOB_EXISTS_DIFFERENT_HASH' });
      return this.ok(id, { jobId, infoHashV1: hash, infoHashV2: '', hasMetadata: s.hasMetadata });
    }
    let s = this.store.get(jobId);
    if (!s || s.infoHashV1 !== hash) {
      const files = (this.opts.files ?? defaultFiles)(name).map((f, index) => ({ ...f, index }));
      s = {
        name,
        infoHashV1: hash,
        files,
        hasMetadata: torrent !== null,
        priorities: files.map(() => 0),
        done: files.map(() => 0),
        uploaded: 0,
      };
      this.store.set(jobId, s);
    }
    const paused = args['paused'] === true;
    const j: LiveJob = {
      id: jobId,
      savePath: typeof args['savePath'] === 'string' ? args['savePath'] : '',
      state: 'fetching_metadata',
      hasSelection: false,
      paused,
      stopped: false,
      seedRatio: null,
      seedMinutes: null,
      seedingMs: 0,
      checkingMs: 0,
      completedFiles: new Set(s.files.filter((f) => s.done[f.index] === f.size).map((f) => f.index)),
      metadataAt: s.hasMetadata ? null : Date.now() + (this.opts.metadataDelayMs ?? 200),
      dirty: true,
      ...(paused ? { reason: 'user' } : {}),
    };
    this.jobs.set(jobId, j);
    this.ok(id, { jobId, infoHashV1: hash, infoHashV2: '', hasMetadata: s.hasMetadata });
    if (s.hasMetadata) this.sendMetadata(j);
    this.updateState(j);
  }

  private sendMetadata(j: LiveJob) {
    const s = this.stored(j);
    this.event('metadata', {
      jobId: j.id,
      name: s.name,
      files: s.files,
      totalSize: s.files.reduce((a, f) => a + f.size, 0),
      infoHashV1: s.infoHashV1,
      infoHashV2: '',
    });
  }

  fileError(jobId: string, reason: string, code: string) {
    const j = this.jobs.get(jobId);
    if (!j) return;
    j.paused = true;
    j.reason = reason;
    j.error = { code, message: reason };
    this.updateState(j);
  }

  private selected(j: LiveJob) {
    const s = this.stored(j);
    let total = 0;
    let done = 0;
    const files: { index: number; doneBytes: number }[] = [];
    if (j.hasSelection) {
      for (const f of s.files) {
        if (f.pad || !s.priorities[f.index]) continue;
        total += f.size;
        done += s.done[f.index] ?? 0;
        files.push({ index: f.index, doneBytes: s.done[f.index] ?? 0 });
      }
    }
    return { total, done, files };
  }

  private computeState(j: LiveJob, ignorePaused = false): { state: EngineState; reason?: string } {
    const s = this.stored(j);
    if (!ignorePaused && j.error) return { state: 'paused', ...(j.reason ? { reason: j.reason } : {}) };
    if (!ignorePaused && j.paused)
      return j.stopped ? { state: 'stopped', reason: 'seed_limit' } : { state: 'paused', reason: j.reason ?? 'user' };
    if (j.checkingMs > 0) return { state: 'checking' };
    if (!s.hasMetadata) return { state: 'fetching_metadata' };
    const sel = this.selected(j);
    if (j.hasSelection && sel.total > 0 && sel.done >= sel.total) return { state: 'seeding' };
    return { state: 'downloading' };
  }

  private updateState(j: LiveJob) {
    const { state, reason } = this.computeState(j);
    if (state === j.lastState && reason === j.lastReason) return;
    if (state === 'seeding' && j.lastState !== 'seeding' && j.lastState !== 'downloaded') {
      this.event('state', { jobId: j.id, state: 'downloaded' });
    }
    this.event('state', {
      jobId: j.id,
      state,
      ...(reason ? { reason } : {}),
      ...(j.error ? { error: j.error } : {}),
    });
    j.lastState = state;
    if (reason === undefined) delete j.lastReason;
    else j.lastReason = reason;
  }

  private status(j: LiveJob): JobStatus {
    const s = this.stored(j);
    const sel = this.selected(j);
    const { state, reason } = this.computeState(j);
    const rate = state === 'downloading' && j.hasSelection ? this.rate() : 0;
    const upload = state === 'seeding' ? (this.opts.uploadRate ?? 0) : 0;
    return {
      jobId: j.id,
      state,
      ...(reason ? { reason } : {}),
      hasMetadata: s.hasMetadata,
      selectedBytes: sel.total,
      selectedDoneBytes: sel.done,
      files: sel.files,
      downloadRate: rate,
      uploadRate: upload,
      peers: this.opts.peers ?? 12,
      seeds: Math.max(0, (this.opts.peers ?? 12) - 4),
      ratio: sel.total > 0 ? s.uploaded / sel.total : 0,
      seedingSeconds: Math.floor(j.seedingMs / 1000),
      etaSeconds:
        rate > 0 ? Math.ceil((sel.total - sel.done) / rate) : sel.total > 0 && sel.done >= sel.total ? 0 : null,
    };
  }

  private rate(): number {
    const r = this.opts.rate ?? 8 * MiB;
    return this.downloadLimit > 0 ? Math.min(r, this.downloadLimit) : r;
  }

  private tick() {
    if (this.closed || this.hung) return;
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    const changed: JobStatus[] = [];
    for (const j of this.jobs.values()) {
      const s = this.stored(j);
      if (j.metadataAt !== null && now >= j.metadataAt && !j.paused) {
        j.metadataAt = null;
        s.hasMetadata = true;
        s.priorities = s.files.map(() => 0);
        this.sendMetadata(j);
        j.dirty = true;
      }
      if (j.checkingMs > 0) {
        j.checkingMs = Math.max(0, j.checkingMs - dt * 1000);
        j.dirty = true;
      }
      const { state } = this.computeState(j);
      if (state === 'downloading' && j.hasSelection) {
        let budget = this.rate() * dt;
        for (const f of s.files) {
          if (budget <= 0) break;
          if (f.pad || !s.priorities[f.index]) continue;
          const left = f.size - (s.done[f.index] ?? 0);
          if (left <= 0) continue;
          const add = Math.min(left, budget);
          s.done[f.index] = (s.done[f.index] ?? 0) + add;
          budget -= add;
          if (s.done[f.index] === f.size && !j.completedFiles.has(f.index)) {
            j.completedFiles.add(f.index);
            this.event('fileCompleted', { jobId: j.id, index: f.index });
          }
        }
        j.dirty = true;
      } else if (state === 'seeding') {
        j.seedingMs += dt * 1000;
        s.uploaded += (this.opts.uploadRate ?? 0) * dt;
        const sel = this.selected(j);
        const ratio = sel.total > 0 ? s.uploaded / sel.total : 0;
        if (
          (j.seedRatio !== null && ratio >= j.seedRatio) ||
          (j.seedMinutes !== null && j.seedingMs >= j.seedMinutes * 60_000)
        ) {
          j.paused = true;
          j.stopped = true;
          j.reason = 'seed_limit';
        }
        j.dirty = true;
      }
      this.updateState(j);
      if (j.dirty) {
        changed.push(this.status(j));
        j.dirty = false;
      }
    }
    if (changed.length > 0) this.event('progress', { jobs: changed });
  }
}
