/// <reference types="node" />
import { vi, describe, it, expect } from 'vitest';
import path from 'path';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import os from 'os';
import { syncEngineRegistry, enginesMissingMuslSafeRecipe } from './sync-engine-registry';

describe("enginesMissingMuslSafeRecipe", () => {
  it("flags only engines whose recipes are ALL non-musl-safe", () => {
    const mk = (recipes: Array<{ muslSafe?: boolean }>) => ({
      binary: "x",
      verify: { command: "", versionRegex: "" },
      bakeInDefault: false,
      recipes,
    });
    const engines = {
      ok: mk([{ muslSafe: true }]),
      bad: mk([{ muslSafe: false }]),
      mixed: mk([{ muslSafe: false }, { muslSafe: true }]),
      none: mk([]),
    };
    expect(enginesMissingMuslSafeRecipe(engines as never)).toEqual(["bad"]);
  });
});

const dataPath = path.join(__dirname, '../data/build-engines.json');

describe('canonical engine registry', () => {
  it('recognizes current and legacy Claude Code versions without accepting malformed output', () => {
    const registry = JSON.parse(readFileSync(dataPath, 'utf-8')) as {
      claude: { verify: { versionRegex: string } };
    };
    const extractVersion = (stdout: string) =>
      new RegExp(registry.claude.verify.versionRegex).exec(stdout)?.[1] ?? null;

    expect(extractVersion('2.1.215 (Claude Code)\n')).toBe('2.1.215');
    expect(extractVersion('claude-cli/1.5.0\n')).toBe('1.5.0');
    expect(extractVersion('Claude Code\n')).toBeNull();
    expect(extractVersion('')).toBeNull();
  });
});

const now = new Date();
const mockResult = { createdAt: now, updatedAt: now };

describe('syncEngineRegistry', () => {
  it('inserts all engines on empty DB', async () => {
    const upsert = vi.fn().mockResolvedValue(mockResult);
    const mockPrisma = {
      buildEngine: { upsert },
    } as never;

    await syncEngineRegistry(mockPrisma, dataPath);

    expect(upsert).toHaveBeenCalledTimes(4);
    expect(upsert.mock.calls.map(([args]) => args.create.engineId)).toEqual([
      'claude',
      'codex',
      'grok',
      'opencode',
    ]);
  });

  it('is idempotent on re-run', async () => {
    const upsert = vi.fn().mockResolvedValue(mockResult);
    const mockPrisma = { buildEngine: { upsert } } as never;

    await syncEngineRegistry(mockPrisma, dataPath);
    await syncEngineRegistry(mockPrisma, dataPath);

    expect(upsert).toHaveBeenCalledTimes(8);
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
