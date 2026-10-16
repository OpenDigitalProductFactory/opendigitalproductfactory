import { describe, expect, it, vi } from "vitest";
import { collectReleaseChangeSet } from "./release-change-set";
const range = { currentLineageSha: "a".repeat(40), targetSha: "b".repeat(40) };
const commit = (sha = range.targetSha) => ({ sha, parents: [{}], commit: { message: "fix: improve upgrades (#42)\n\nbody", author: { name: "Author", date: "2026-10-12T00:00:00Z" } } });
const reply = (commits = [commit()], total = commits.length, status = "ahead") => new Response(JSON.stringify({ status, total_commits: total, commits }));
describe("release change set", () => {
  it("compares exact source revisions and does not invent per-commit files", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply());
    expect(await collectReleaseChangeSet(range, fetcher)).toEqual([{ sha: range.targetSha, subject: "fix: improve upgrades (#42)", author: "Author", authorDate: "2026-10-12T00:00:00Z", files: [] }]);
    expect(fetcher.mock.calls[0][0]).toContain(`/compare/${range.currentLineageSha}...${range.targetSha}?per_page=100&page=1`);
  });
  it("continues through pages instead of silently truncating counts", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply([commit("c".repeat(40))], 2)).mockResolvedValueOnce(reply([commit()], 2));
    expect(await collectReleaseChangeSet(range, fetcher)).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toContain("page=2");
  });
  it.each(["behind", "diverged"])("rejects %s lineage", async status => {
    await expect(collectReleaseChangeSet(range, vi.fn().mockResolvedValue(reply([], 0, status)))).rejects.toThrow("reliably");
  });
  it("reports provider availability without declaring the update target missing", async () => {
    await expect(collectReleaseChangeSet(range, vi.fn().mockResolvedValue(new Response("", { status: 429 })))).rejects.toThrow("Published change details");
  });
  it("rejects incomplete and oversized ranges", async () => {
    await expect(collectReleaseChangeSet(range, vi.fn().mockResolvedValue(reply([], 1)))).rejects.toThrow("incomplete");
    await expect(collectReleaseChangeSet(range, vi.fn().mockResolvedValue(reply([], 1001)))).rejects.toThrow("too many");
  });
});
