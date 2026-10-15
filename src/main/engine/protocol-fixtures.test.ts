import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type EngineOp, engineEventSchema, engineResponseSchema, engineResultSchemas } from '@shared/contracts/engine';

/**
 * Contract test: sessions recorded from the real adrenaline-engine (swarm test with ADRENALINE_RECORD_PROTOCOL)
 * must parse with the Zod schemas the app uses. `>` = request, `<` = engine output.
 */
const DIR = join(import.meta.dirname, '../../../tests/fixtures/engine-protocol');
const files = readdirSync(DIR).filter((f) => f.endsWith('.jsonl'));

describe('engine protocol fixtures', () => {
  it('has recorded sessions', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s matches the schemas', (file) => {
    const ops = new Map<string, EngineOp>();
    const seen = new Set<string>();
    let lastSeq = 0;
    for (const raw of readFileSync(join(DIR, file), 'utf8').split('\n')) {
      if (!raw.trim()) continue;
      const line = raw.slice(2);
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (raw.startsWith('> ')) {
        ops.set(obj['id'] as string, obj['op'] as EngineOp);
        continue;
      }
      if ('event' in obj) {
        const ev = engineEventSchema.parse(obj);
        expect(ev.seq).toBe(lastSeq + 1);
        lastSeq = ev.seq;
        seen.add(`event:${ev.event}`);
        continue;
      }
      const res = engineResponseSchema.parse(obj);
      const op = ops.get(res.id);
      expect(op, `request for ${res.id}`).toBeDefined();
      if (res.ok) engineResultSchemas[op!].parse(res.result);
      seen.add(`op:${op}`);
    }
    expect(seen.has('event:ready')).toBe(true);
    expect(seen.has('op:hello')).toBe(true);
  });
});
