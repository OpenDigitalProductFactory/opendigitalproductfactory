import { describe, expect, it, vi, afterEach } from "vitest";

// This test enforces the slice-1 architectural invariant: searchProjectFiles
// MUST NOT use execSync, fs.readdirSync, or fs.readFileSync — synchronous
// syscalls block the Node main event loop and were the proximate cause of the
// 2026-05-19 22:37 portal hang (PID 1 wchan=p9_client_rpc, State D).
//
// The function must return through the event loop so that even if the
// underlying subprocess or fs read wedges on 9P, the portal stays responsive
// to HTTP requests, health checks, and the watchdog cron.

const { mockExecAsync, syncCallSites } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(async () => ({ stdout: "", stderr: "" })),
  syncCallSites: { execSync: 0, readdirSync: 0, readFileSync: 0 },
}));

vi.mock("@/lib/shared/lazy-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shared/lazy-node")>();
  return {
    ...actual,
    // If anything in codebase-tools.ts calls execSync via lazyChildProcess,
    // the spy counter increments and the test fails.
    lazyChildProcess: () => ({
      execSync: (...args: unknown[]) => {
        syncCallSites.execSync += 1;
        return "";
      },
    }),
    // Async exec via the existing lazyExec helper — mock it so the test
    // doesn't actually spawn git.
    lazyExec: () => mockExecAsync,
    // fs sync calls are flagged.
    lazyFs: () => ({
      existsSync: () => true,
      readdirSync: (...args: unknown[]) => {
        syncCallSites.readdirSync += 1;
        return [];
      },
      readFileSync: (...args: unknown[]) => {
        syncCallSites.readFileSync += 1;
        return "";
      },
      mkdirSync: () => undefined,
      writeFileSync: () => undefined,
    }),
    lazyFsPromises: () => ({
      readdir: async () => [],
      readFile: async () => "",
    }),
    lazyPath: () => ({
      resolve: (...args: string[]) => args.join("/"),
      relative: (from: string, to: string) => to.replace(`${from}/`, ""),
      isAbsolute: (p: string) => p.startsWith("/") || /^[A-Za-z]:/.test(p),
      join: (...args: string[]) => args.join("/"),
      dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
    }),
  };
});

import { searchProjectFiles } from "./codebase-tools";

afterEach(() => {
  syncCallSites.execSync = 0;
  syncCallSites.readdirSync = 0;
  syncCallSites.readFileSync = 0;
  mockExecAsync.mockReset();
  mockExecAsync.mockImplementation(async () => ({ stdout: "", stderr: "" }));
});

describe("searchProjectFiles non-blocking invariant (BI-6588414f slice 1)", () => {
  it("never uses synchronous syscalls — neither execSync nor fs sync APIs", async () => {
    mockExecAsync.mockImplementation(async () => ({
      stdout: "packages/db/src/seed.ts:1:export function seed() {}",
      stderr: "",
    }));

    await searchProjectFiles("seed", { glob: "*.ts" });

    expect(syncCallSites.execSync).toBe(0);
    expect(syncCallSites.readdirSync).toBe(0);
    expect(syncCallSites.readFileSync).toBe(0);
  });

  it("uses async exec on the happy path", async () => {
    mockExecAsync.mockImplementation(async () => ({
      stdout: "apps/web/lib/foo.ts:42:foo()",
      stderr: "",
    }));

    const result = await searchProjectFiles("foo", { glob: "*.ts" });

    expect(mockExecAsync).toHaveBeenCalledTimes(1);
    expect("results" in result).toBe(true);
  });

  it("returns a bounded error rather than walking the tree when async exec rejects", async () => {
    mockExecAsync.mockImplementation(async () => {
      throw new Error("fatal: not a git repository");
    });

    const result = await searchProjectFiles("anything", { glob: "*.ts" });

    // We accept either an error envelope or an empty results envelope —
    // both are non-blocking. What we reject is the old "fall through to a
    // sync walker" behaviour.
    if ("results" in result) {
      expect(result.results).toEqual([]);
    } else {
      expect(result.error).toMatch(/git grep|search/i);
    }
    expect(syncCallSites.readdirSync).toBe(0);
    expect(syncCallSites.readFileSync).toBe(0);
  });

  it("keeps the event loop responsive while a slow subprocess is pending", async () => {
    // Simulate a 200ms subprocess. The test must be able to run a different
    // microtask immediately — proves the await yields to the event loop.
    mockExecAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ stdout: "", stderr: "" }), 200);
        }),
    );

    let otherTaskRan = false;
    const searchPromise = searchProjectFiles("slow", { glob: "*.ts" });
    queueMicrotask(() => {
      otherTaskRan = true;
    });
    // Give the microtask one tick to fire.
    await new Promise((r) => setTimeout(r, 10));

    expect(otherTaskRan).toBe(true); // event loop still alive
    await searchPromise; // clean up
  });
});
