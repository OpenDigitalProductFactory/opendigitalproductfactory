/**
 * BI-CE661173 — the merged squash commit a post-implementation review reads
 * once the delivering room has retired. Driven against a REAL repository, for
 * the reason BI-043946C5 gives: the defect lives at the git boundary.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findMergedDeliveryCommits, resolveMergedDeliveryCommitFromDb } from "./merge-delivery-signal";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[], date?: string) {
  const env = date ? { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : process.env;
  return execFileAsync("git", ["-C", root, ...args], { windowsHide: true, env });
}

let fileCounter = 0;
async function commit(root: string, subject: string, body?: string, date?: string): Promise<string> {
  await writeFile(path.join(root, `f${fileCounter++}.txt`), `${subject}\n`);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", subject, ...(body ? ["-m", body] : [])], date);
  return (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
}

describe("the merged delivery commit (BI-CE661173)", () => {
  let root: string;
  const sha: Record<string, string> = {};

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dpf-merged-commit-ce661173-"));
    await git(root, ["init", "-q", "--initial-branch=main"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await git(root, ["config", "user.name", "Test"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await git(root, ["config", "core.hooksPath", "/dev/null"]);
    sha.base = await commit(root, "chore: base (#300)");
    sha.delivered = await commit(root, "fix(x): repair the thing (BI-AAAA1111) (#301)");
    // Delivered by a PR the room recorded, whose message does not name the item.
    sha.roomPr = await commit(root, "fix(y): quiet repair (#302)");
    // Delivered, then reverted.
    sha.reverted = await commit(root, "fix(z): repair (BI-CCCC3333) (#303)");
    await commit(root, "Revert \"fix(z): repair (BI-CCCC3333) (#303)\" (#304)");
    // Delivered across two PRs.
    sha.splitOne = await commit(root, "fix(w): first half (BI-DDDD4444) (#305)");
    sha.splitTwo = await commit(root, "fix(w): second half (BI-DDDD4444) (#306)");
    // Only cited.
    await commit(root, "chore: tidy (#307)", "Refs: BI-EEEE5555");
    // Delivered before a later reopen.
    sha.old = await commit(root, "fix(v): old repair (BI-FFFF6666) (#308)", undefined, "2026-01-01T00:00:00Z");
    const tip = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    await git(root, ["update-ref", "refs/remotes/origin/main", tip]);
  }, 60_000);

  afterAll(async () => { await rm(root, { recursive: true, force: true }).catch(() => {}); });

  const item = (itemId: string) => ({ itemId, workType: "bug" });

  it("names the squash commit that delivered the item, with its parent as the range base", async () => {
    const commits = await findMergedDeliveryCommits(root, item("BI-AAAA1111"));
    expect(commits).toEqual([{ sha: sha.delivered, parentSha: sha.base, subject: "fix(x): repair the thing (BI-AAAA1111) (#301)" }]);
  });

  it("finds the squash commit of the PR the delivering room recorded", async () => {
    const commits = await findMergedDeliveryCommits(root, item("BI-BBBB2222"), { roomPullRequests: [302] });
    expect(commits?.map((c) => c.sha)).toEqual([sha.roomPr]);
  });

  it("does not name a reverted, merely cited, or pre-reopen commit", async () => {
    await expect(findMergedDeliveryCommits(root, item("BI-CCCC3333"))).resolves.toEqual([]);
    await expect(findMergedDeliveryCommits(root, item("BI-EEEE5555"))).resolves.toEqual([]);
    await expect(findMergedDeliveryCommits(root, item("BI-FFFF6666"), { after: new Date("2026-06-01T00:00:00Z") })).resolves.toEqual([]);
  });

  it("reports a delivery split across PRs as ambiguous rather than picking one", async () => {
    const db = { backlogItemActivity: { findMany: async () => [] } };
    const result = await resolveMergedDeliveryCommitFromDb(db, { itemRowId: "row", itemId: "BI-DDDD4444", workType: "bug", roomPullRequests: [] }, { roots: [root] });
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.commits.map((c) => c.sha).sort()).toEqual([sha.splitOne, sha.splitTwo].sort());
  });

  it("orders a split delivery oldest first, so its ranges are reviewed in trunk order (BI-46E344FE)", async () => {
    const commits = await findMergedDeliveryCommits(root, item("BI-DDDD4444"), { roomPullRequests: [306] });
    expect(commits?.map((c) => c.sha)).toEqual([sha.splitOne, sha.splitTwo]);
  });

  it("answers found, not-found, and unavailable from the database half", async () => {
    const db = { backlogItemActivity: { findMany: async () => [] } };
    await expect(resolveMergedDeliveryCommitFromDb(db, { itemRowId: "row", itemId: "BI-AAAA1111", workType: "bug", roomPullRequests: [] }, { roots: [root] }))
      .resolves.toMatchObject({ kind: "found", commit: { sha: sha.delivered, parentSha: sha.base } });
    await expect(resolveMergedDeliveryCommitFromDb(db, { itemRowId: "row", itemId: "BI-NOTHERE1", workType: "bug", roomPullRequests: [] }, { roots: [root] }))
      .resolves.toEqual({ kind: "not-found" });
    await expect(resolveMergedDeliveryCommitFromDb(db, { itemRowId: "row", itemId: "BI-AAAA1111", workType: "bug", roomPullRequests: [] }, { roots: [path.join(root, "missing")] }))
      .resolves.toEqual({ kind: "signal-unavailable" });
  });
});
