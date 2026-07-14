import { describe, it, expect, vi } from "vitest";
import { parseLedgerLog, collectLocalChanges, LEDGER_LOG_FORMAT } from "./local-changes-ledger";
import type { GitResult } from "./prepare-source";

const SEP = "\x1f";
const ok = (stdout: string): GitResult => ({ stdout, stderr: "", code: 0 });
const fail = (): GitResult => ({ stdout: "", stderr: "not a git repository", code: 128 });

describe("parseLedgerLog", () => {
  it("parses sha/subject/date rows and truncates the sha", () => {
    const out = [
      `abcdef1234567890${SEP}feat: pricing tweak${SEP}2026-06-19T10:00:00Z`,
      `0011223344556677${SEP}fix: internal report${SEP}2026-06-18T09:00:00Z`,
    ].join("\n");
    expect(parseLedgerLog(out)).toEqual([
      { sha: "abcdef123456", subject: "feat: pricing tweak", date: "2026-06-19T10:00:00Z" },
      { sha: "001122334455", subject: "fix: internal report", date: "2026-06-18T09:00:00Z" },
    ]);
  });
  it("ignores blank lines and malformed rows", () => {
    expect(parseLedgerLog("\n  \n")).toEqual([]);
  });
});

describe("collectLocalChanges", () => {
  it("returns unavailable for a non-git install (consumer mode)", async () => {
    const run = vi.fn().mockResolvedValueOnce(fail());
    const res = await collectLocalChanges(run, { hostSourcePath: "/workspace", remote: "origin", branch: "main", installBranch: "dpf/install" });
    expect(res.available).toBe(false);
    expect(res.changes).toEqual([]);
    expect(res.note).toMatch(/does not track changes in git/i);
  });

  it("returns the local-only commits when git succeeds", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(ok("true")) // rev-parse is-inside-work-tree
      .mockResolvedValueOnce(ok(`deadbeef0000${SEP}feat: keep this private${SEP}2026-06-19T00:00:00Z`)); // log
    const res = await collectLocalChanges(run, { hostSourcePath: "/workspace", remote: "origin", branch: "main", installBranch: "dpf/install" });
    expect(res.available).toBe(true);
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0].subject).toBe("feat: keep this private");
    // BI-75C4A412: content diff, not sha range — three-dot symmetric range with
    // --cherry-pick --right-only drops commits already upstreamed under a
    // different (squash-rebased) sha.
    const logArgs = run.mock.calls.at(-1)?.[0] as string[];
    expect(logArgs).toContain("origin/main...dpf/install");
    expect(logArgs).not.toContain("origin/main..dpf/install");
    expect(logArgs).toContain("--cherry-pick");
    expect(logArgs).toContain("--right-only");
    expect(logArgs).toContain(`--format=${LEDGER_LOG_FORMAT}`);
  });

  it("returns unavailable (not an error) when the log command fails", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok("true")).mockResolvedValueOnce(fail());
    const res = await collectLocalChanges(run, { hostSourcePath: "/workspace", remote: "origin", branch: "main", installBranch: "dpf/install" });
    expect(res.available).toBe(false);
  });
});
