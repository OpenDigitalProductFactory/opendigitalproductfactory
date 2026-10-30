/**
 * BI-D9DC902E — the trunk itself is delivery evidence.
 *
 * Measured 2026-10-27 on the live install: 51 awaiting-acceptance items had a
 * merged commit on origin/main that delivered them under the PR-submit
 * actuator's own rule, yet the merge signal never saw it — 42 had no
 * status-change row at all, the rest recorded a different or earlier PR
 * (BI-1281A164 recorded docs PR #5301 and was delivered by #5529/#5530). So
 * when no recorded identity finds a merge, the signal searches the trunk for a
 * commit that DELIVERS the item, under the same rule: a bare mention or a
 * "Refs:" line still does not count, a reverted commit does not count, a doc
 * commit delivers only a doc item, and a commit from before the item was
 * reopened cannot close the reopened work.
 *
 * Driven against REAL repositories, for the reason BI-043946C5 gives.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { latestReopenAt, resolveMergeDeliveryFromDb, resolveMergeSignalFromRefs } from "./merge-delivery-signal";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[], date?: string) {
  const env = date ? { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : process.env;
  return execFileAsync("git", ["-C", root, ...args], { windowsHide: true, env });
}

let fileCounter = 0;
async function commit(root: string, subject: string, body?: string, date?: string) {
  await writeFile(path.join(root, `f${fileCounter++}.txt`), `${subject}\n`);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", subject, ...(body ? ["-m", body] : [])], date);
}

describe("the trunk as delivery evidence when no PR was recorded (BI-D9DC902E)", () => {
  let root: string;
  const now = new Date();
  const fresh = async () => now;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dpf-trunk-search-d9dc902e-"));
    await git(root, ["init", "-q", "--initial-branch=main"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await git(root, ["config", "user.name", "Test"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await git(root, ["config", "core.hooksPath", "/dev/null"]);
    await commit(root, "chore: base (#200)");
    // Delivered in the title.
    await commit(root, "feat(x): ship the thing (BI-EEEE5555) (#201)");
    // Only cited — a Refs: line and prose. Not delivery.
    await commit(root, "chore: tidy up (#202)", "Refs: BI-FFFF6666\nRelated to BI-FFFF6666 as context.");
    // Delivered, then reverted.
    await commit(root, "feat(y): ship (BI-GGGG7777) (#203)");
    await commit(root, "Revert \"feat(y): ship (BI-GGGG7777) (#203)\" (#204)", "This reverts commit deadbeef.");
    // One delivering PR reverted, another still standing (the BI-3907AF35 shape).
    await commit(root, "feat(z): first try (BI-HHHH8888) (#205)");
    await commit(root, "Revert \"feat(z): first try (BI-HHHH8888) (#205)\" (#206)");
    await commit(root, "feat(z): second try (BI-HHHH8888) (#207)");
    // Delivered long ago, before a later reopen.
    await commit(root, "fix(w): old delivery (BI-JJJJ9999) (#208)", undefined, "2026-01-01T00:00:00Z");
    // A doc commit delivers only a doc item.
    await commit(root, "docs(plan): plan the work (BI-KKKK0000) (#209)");
    // Delivered by a keyword in the body.
    await commit(root, "feat(v): land it (#210)", "Fixes BI-LLLL1111");
    // A revert with no PR marker, recognised by the sha it names.
    await commit(root, "feat(u): direct push (BI-MMMM2222)");
    const direct = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    await commit(root, "Revert \"feat(u): direct push (BI-MMMM2222)\"", `This reverts commit ${direct}.`);
    const tip = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    await git(root, ["update-ref", "refs/remotes/origin/main", tip]);
  }, 60_000);

  afterAll(async () => { await rm(root, { recursive: true, force: true }).catch(() => {}); });

  const signal = (itemId: string, workType: string | null = "feature", deliveredAfter: Date | null = null) =>
    resolveMergeSignalFromRefs({
      heads: [],
      pullRequests: [],
      attestedPullRequests: [],
      item: { itemId, workType },
      deliveredAfter,
      roots: [root],
      now,
      readTrunkCommittedAt: fresh,
    });

  it("an item with no recorded PR is merged when a trunk commit delivers it", async () => {
    await expect(signal("BI-EEEE5555")).resolves.toBe("merged");
    await expect(signal("BI-LLLL1111")).resolves.toBe("merged");
  });

  it("a commit that only mentions the item does not deliver it", async () => {
    await expect(signal("BI-FFFF6666")).resolves.toBe("not-merged");
  });

  it("a reverted commit does not deliver the item", async () => {
    await expect(signal("BI-GGGG7777")).resolves.toBe("not-merged");
    await expect(signal("BI-MMMM2222")).resolves.toBe("not-merged");
  });

  it("a reverted attempt does not hide a later delivering commit that stands", async () => {
    await expect(signal("BI-HHHH8888")).resolves.toBe("merged");
  });

  it("a commit from before the item's latest reopen cannot close the reopened work", async () => {
    await expect(signal("BI-JJJJ9999", "bug", new Date("2026-06-01T00:00:00Z"))).resolves.toBe("not-merged");
    await expect(signal("BI-JJJJ9999", "bug", new Date("2025-06-01T00:00:00Z"))).resolves.toBe("merged");
  });

  it("a doc commit delivers a doc item and nothing else", async () => {
    await expect(signal("BI-KKKK0000", "feature")).resolves.toBe("not-merged");
    await expect(signal("BI-KKKK0000", "doc")).resolves.toBe("merged");
  });

  it("the trunk search falls back only after a recorded PR fails to deliver", async () => {
    // BI-1281A164's shape: the recorded PR is a doc PR that cannot deliver a
    // feature, while the trunk carries the feature commit that does.
    await expect(resolveMergeSignalFromRefs({
      heads: [], pullRequests: [], attestedPullRequests: [209],
      item: { itemId: "BI-EEEE5555", workType: "feature" },
      roots: [root], now, readTrunkCommittedAt: fresh,
    })).resolves.toBe("merged");
  });

  it("an item that the trunk never delivered is not-merged only against a fresh trunk", async () => {
    await expect(signal("BI-NOTHERE1")).resolves.toBe("not-merged");
    await expect(resolveMergeSignalFromRefs({
      heads: [], pullRequests: [], item: { itemId: "BI-NOTHERE1", workType: "bug" },
      roots: [root], now, readTrunkCommittedAt: async () => null,
    })).resolves.toBe("signal-unavailable");
  });

  it("the database resolver searches the trunk when the item has no recorded PR at all", async () => {
    const db = {
      workroom: { findMany: async () => [] },
      backlogItemActivity: { findMany: async () => [] },
    };
    await expect(resolveMergeDeliveryFromDb(db, { itemRowId: "row-1", itemId: "BI-EEEE5555", workType: "feature" }, {
      roots: [root], now, readTrunkCommittedAt: fresh,
    })).resolves.toBe("merged");
  });

  it("the database resolver applies the latest reopen as the cut-off", async () => {
    const reopened = [
      { kind: "status_change", payload: { from: "awaiting-acceptance", to: "open" }, recordedAt: new Date("2026-06-01T00:00:00Z") },
    ];
    const db = {
      workroom: { findMany: async () => [] },
      backlogItemActivity: {
        findMany: async (args: { where: { kind: string } }) => (args.where.kind === "status_change" ? reopened : []),
      },
    };
    await expect(resolveMergeDeliveryFromDb(db, { itemRowId: "row-1", itemId: "BI-JJJJ9999", workType: "bug" }, {
      roots: [root], now, readTrunkCommittedAt: fresh,
    })).resolves.toBe("not-merged");
  });
});

describe("latestReopenAt", () => {
  it("is the newest move back into the coding pool, or null", () => {
    const at = new Date("2026-06-01T00:00:00Z");
    expect(latestReopenAt([
      { kind: "status_change", payload: { to: "awaiting-acceptance" }, recordedAt: new Date("2026-07-01T00:00:00Z") },
      { kind: "status_change", payload: { to: "in-progress" }, recordedAt: at },
      { kind: "status_change", payload: { to: "open" }, recordedAt: new Date("2026-05-01T00:00:00Z") },
    ])).toEqual(at);
    expect(latestReopenAt([{ kind: "status_change", payload: { to: "awaiting-acceptance" }, recordedAt: at }])).toBeNull();
  });
});
