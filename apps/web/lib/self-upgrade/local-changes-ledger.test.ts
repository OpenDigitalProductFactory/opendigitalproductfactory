import { describe, it, expect, vi } from "vitest";
import {
  parseNumstat,
  collectLocalChanges,
  getLocalChangesLedger,
} from "./local-changes-ledger";
import type { LocalChangesResult } from "./local-changes-ledger";
import type { GitResult } from "./prepare-source";

const ok = (stdout: string): GitResult => ({ stdout, stderr: "", code: 0 });
const fail = (): GitResult => ({ stdout: "", stderr: "not a git repository", code: 128 });

describe("parseNumstat", () => {
  it("parses added/deleted/path rows", () => {
    const out = ["12\t3\tapps/web/lib/foo.ts", "0\t54\tapps/web/components/Bar.tsx"].join("\n");
    expect(parseNumstat(out)).toEqual([
      { path: "apps/web/lib/foo.ts", added: 12, deleted: 3 },
      { path: "apps/web/components/Bar.tsx", added: 0, deleted: 54 },
    ]);
  });

  it("treats binary '-' counts as 0", () => {
    expect(parseNumstat("-\t-\tpublic/logo.png")).toEqual([
      { path: "public/logo.png", added: 0, deleted: 0 },
    ]);
  });

  it("keeps tab characters that appear inside a path", () => {
    expect(parseNumstat("1\t2\tweird\tname.ts")).toEqual([
      { path: "weird\tname.ts", added: 1, deleted: 2 },
    ]);
  });

  it("ignores blank lines, CRs, and malformed rows", () => {
    expect(parseNumstat("\n  \r\n1\t2")).toEqual([]);
  });
});

describe("collectLocalChanges", () => {
  it("returns unavailable for a non-git install (consumer mode)", async () => {
    const run = vi.fn().mockResolvedValueOnce(fail());
    const res = await collectLocalChanges(run, {
      hostSourcePath: "/workspace",
      remote: "origin",
      branch: "main",
      installBranch: "dpf/install",
    });
    expect(res.available).toBe(false);
    expect(res.changes).toEqual([]);
    expect(res.note).toMatch(/does not track changes in git/i);
  });

  it("returns the private file delta via a three-dot content diff", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("true")) // rev-parse is-inside-work-tree
      .mockResolvedValueOnce(ok("40\t2\tapps/web/lib/pricing.ts")); // diff --numstat
    const res = await collectLocalChanges(run, {
      hostSourcePath: "/workspace",
      remote: "origin",
      branch: "main",
      installBranch: "dpf/install",
    });
    expect(res.available).toBe(true);
    expect(res.changes).toEqual([{ path: "apps/web/lib/pricing.ts", added: 40, deleted: 2 }]);
    // Uses the three-dot diff range (merge-base..install), NOT a commit-range log —
    // commit identity is destroyed by squash-merges, so only content is honest.
    expect(run).toHaveBeenLastCalledWith(
      expect.arrayContaining(["diff", "--numstat", "--no-renames", "origin/main...dpf/install"]),
    );
  });

  it("reports nothing private when the content diff is empty", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok("true")).mockResolvedValueOnce(ok(""));
    const res = await collectLocalChanges(run, {
      hostSourcePath: "/workspace",
      remote: "origin",
      branch: "main",
      installBranch: "dpf/install",
    });
    expect(res.available).toBe(true);
    expect(res.changes).toEqual([]);
  });

  it("caps the file list at max", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => `1\t0\tfile${i}.ts`).join("\n");
    const run = vi.fn().mockResolvedValueOnce(ok("true")).mockResolvedValueOnce(ok(rows));
    const res = await collectLocalChanges(run, {
      hostSourcePath: "/workspace",
      remote: "origin",
      branch: "main",
      installBranch: "dpf/install",
      max: 2,
    });
    expect(res.changes).toHaveLength(2);
  });

  it("returns unavailable (not an error) when the diff command fails", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok("true")).mockResolvedValueOnce(fail());
    const res = await collectLocalChanges(run, {
      hostSourcePath: "/workspace",
      remote: "origin",
      branch: "main",
      installBranch: "dpf/install",
    });
    expect(res.available).toBe(false);
  });
});

describe("getLocalChangesLedger render deadline (BI-4A400DE4)", () => {
  const collected: LocalChangesResult = {
    available: true,
    changes: [{ path: "apps/web/lib/private.ts", added: 3, deleted: 1 }],
  };

  it("returns the collected result when git resolves before the deadline", async () => {
    const res = await getLocalChangesLedger({
      collect: async () => collected,
      deadlineMs: 50,
    });
    expect(res).toEqual(collected);
  });

  it("degrades to 'unavailable' (never hangs) when collection exceeds the deadline", async () => {
    const res = await getLocalChangesLedger({
      // Simulates a hung/slow git that never resolves within the render window.
      collect: () => new Promise<LocalChangesResult>(() => {}),
      deadlineMs: 10,
    });
    expect(res.available).toBe(false);
    expect(res.changes).toEqual([]);
    expect(res.note).toMatch(/unavailable/i);
  });

  it("degrades to 'unavailable' when collection throws", async () => {
    const res = await getLocalChangesLedger({
      collect: async () => {
        throw new Error("boom");
      },
      deadlineMs: 50,
    });
    expect(res.available).toBe(false);
  });
});
