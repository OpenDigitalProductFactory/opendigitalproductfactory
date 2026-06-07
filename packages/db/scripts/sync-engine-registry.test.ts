/// <reference types="node" />
import { vi, describe, it, expect } from 'vitest';
import path from 'path';
import { writeFileSync, mkdtempSync } from 'fs';
import os from 'os';
import { syncEngineRegistry } from './sync-engine-registry';

const dataPath = path.join(__dirname, '../data/build-engines.json');

const now = new Date();
const mockResult = { createdAt: now, updatedAt: now };

describe('syncEngineRegistry', () => {
  it('inserts all engines on empty DB', async () => {
    const upsert = vi.fn().mockResolvedValue(mockResult);
    const mockPrisma = {
      buildEngine: { upsert },
    } as never;

    await syncEngineRegistry(mockPrisma, dataPath);

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls.map(([args]) => args.create.engineId)).toEqual([
      'claude',
      'codex',
      'grok',
    ]);
  });

  it('is idempotent on re-run', async () => {
    const upsert = vi.fn().mockResolvedValue(mockResult);
    const mockPrisma = { buildEngine: { upsert } } as never;

    await syncEngineRegistry(mockPrisma, dataPath);
    await syncEngineRegistry(mockPrisma, dataPath);

    expect(upsert).toHaveBeenCalledTimes(6);
  });

  it('throws with file path on malformed JSON', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sync-engine-test-'));
    const badPath = path.join(tmpDir, 'bad.json');
    writeFileSync(badPath, '{invalid json}');

    const upsert = vi.fn();
    const mockPrisma = { buildEngine: { upsert } } as never;

    await expect(syncEngineRegistry(mockPrisma, badPath)).rejects.toThrow(badPath);
    expect(upsert).not.toHaveBeenCalled();
  });
});
