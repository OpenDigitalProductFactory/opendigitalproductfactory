/**
 * BI-B04A0203 (EP-4614F35E) — the PR the platform itself recorded as delivering
 * an item is a merge identity the completion gate reads.
 *
 * Measured 2026-10-06 on the live install: 535 direct-merge platform items sat in
 * awaiting-acceptance, and for 235 of them the ONLY record of the PR that
 * delivered them was the `status_change` row the server-side PR-submit actuator
 * wrote when it moved them there. The merge signal read Workroom heads, Workroom
 * PR numbers and evidence links — never that row — so the gate answered
 * "no branch identity" for work whose squash commit is on the trunk.
 *
 * The git half runs against REAL repositories, for the reason BI-043946C5 gives:
 * the defect class lives in the boundary between this module and git.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveMergeSignalFromRefs } from "./backlog-terminal-transition";
import {
  deliveryAttemptPullRequests,
  resolveMergeDeliveryFromDb,
  trunkCommitDeliversItem,
} from "./merge-delivery-signal";

const execFileAsync = promisify(execFile);
const git = (root: string, ...args: string[]) => execFileAsync("git", ["-C", root, ...args], { windowsHide: true });

const prSubmit = (pullRequestNumber: unknown, to = "awaiting-acceptance") => ({
  kind: "status_change",
  payload: { from: "open", to, actuator: "pr-submit-awaiting-acceptance", pullRequestNumber },
});

describe("deliveryAttemptPullRequests", () => {
  it("reads the PR the server-side PR-submit actuator recorded", () => {
    expect(deliveryAttemptPullRequests([prSubmit(6020)])).toEqual([6020]);
  });

  it("ignores rows any other writer produced, and rows that carry no PR", () => {
    expect(deliveryAttemptPullRequests([
      { kind: "status_change", payload: { to: "awaiting-acceptance", actuator: "pr-submit-backfill" } },
      { kind: "status_change", payload: { to: "awaiting-acceptance", pullRequestNumber: 77 } },
      { kind: "evidence", payload: { actuator: "pr-submit-awaiting-acceptance", pullRequestNumber: 78, to: "awaiting-acceptance" } },
      prSubmit("79"),
      prSubmit(-3),
    ])).toEqual([]);
  });

  it("stops at the newest reopen: an earlier attempt's PR cannot close reopened work", () => {
    // newest first, as the resolver reads them
    expect(deliveryAttemptPullRequests([
      prSubmit(30),
      { kind: "status_change", payload: { from: "awaiting-acceptance", to: "open", actuator: "pr-submit-awaiting-acceptance", pullRequestNumber: 20 } },
      prSubmit(20),
    ])).toEqual([30]);
    expect(deliveryAttemptPullRequests([
      { kind: "status_change", payload: { from: "done", to: "in-progress" } },
      prSubmit(20),
    ])).toEqual([]);
  });
});

describe("trunkCommitDeliversItem", () => {
  it("re-derives delivery from the squash commit with the actuator's own rule", () => {
    expect(trunkCommitDeliversItem({ subject: "fix(x): repair (BI-AAAA1111) (#5)", body: "" }, { itemId: "BI-AAAA1111", workType: "bug" })).toBe(true);
    expect(trunkCommitDeliversItem({ subject: "feat(x): thing (#5)", body: "Resolves BI-AAAA1111" }, { itemId: "BI-AAAA1111", workType: "feature" })).toBe(true);
  });

  it("does not count a commit that only cites the item (BI-A0020FAC)", () => {
    expect(trunkCommitDeliversItem({ subject: "feat(x): thing (#5)", body: "Related to BI-AAAA1111" }, { itemId: "BI-AAAA1111", workType: "feature" })).toBe(false);
  });

  it("a doc PR delivers only a doc item", () => {
    const docCommit = { subject: "doc(plan): plan the thing (BI-AAAA1111) (#5)", body: "" };
    expect(trunkCommitDeliversItem(docCommit, { itemId: "BI-AAAA1111", workType: "feature" })).toBe(false);
    expect(trunkCommitDeliversItem(docCommit, { itemId: "BI-AAAA1111", workType: "doc" })).toBe(true);
  });
});

type Repo = { root: string };

async function commit(root: string, file: string, message: string, body?: string) {
  await writeFile(path.join(root, file), `${message}\n`);
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", message, ...(body ? ["-m", body] : []));
}

async function makeRepo(): Promise<Repo> {
  const root = await mkdtemp(path.join(tmpdir(), "dpf-merge-identity-b04a0203-"));
  await git(root, "init", "-q", "--initial-branch=main");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "commit.gpgsign", "false");
  await commit(root, "a.txt", "fix(gate): repair the gate (BI-AAAA1111) (#101)");
  await commit(root, "b.txt", "feat(other): unrelated work (#102)", "Context: this follows on from BI-BBBB2222.");
  await commit(root, "c.txt", "doc(plan): plan the feature (BI-CCCC3333) (#103)");
  await commit(root, "d.txt", "feat(x): ship it (BI-DDDD4444) (#104)");
  await commit(root, "e.txt", "Revert \"feat(x): ship it (BI-DDDD4444) (#104)\" (#105)");
  const tip = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  await git(root, "update-ref", "refs/remotes/origin/main", tip);
  return { root };
}

describe("attested pull requests against a real trunk", () => {
  let repo: Repo;
  const now = new Date();
  const fresh = async () => now;

  beforeAll(async () => { repo = await makeRepo(); });
  afterAll(async () => { await rm(repo.root, { recursive: true, force: true }).catch(() => {}); });

  const signal = (attestedPullRequests: number[], itemId: string, workType: string | null = "bug") =>
    resolveMergeSignalFromRefs({
      heads: [],
      pullRequests: [],
      attestedPullRequests,
      item: { itemId, workType },
      roots: [repo.root],
      now,
      readTrunkCommittedAt: fresh,
    });

  it("an attested PR whose squash commit delivers the item is merged", async () => {
    await expect(signal([101], "BI-AAAA1111")).resolves.toBe("merged");
  });

  it("an attested PR whose squash commit only cites the item is not this item's merge", async () => {
    await expect(signal([102], "BI-BBBB2222")).resolves.toBe("not-merged");
  });

  it("a doc PR does not merge a non-doc item, and does merge a doc item", async () => {
    await expect(signal([103], "BI-CCCC3333", "feature")).resolves.toBe("not-merged");
    await expect(signal([103], "BI-CCCC3333", "doc")).resolves.toBe("merged");
  });

  it("a PR reverted on the trunk is not delivery", async () => {
    await expect(signal([104], "BI-DDDD4444")).resolves.toBe("not-merged");
  });

  it("an attested PR the trunk never received is not merged on a fresh trunk", async () => {
    await expect(signal([999], "BI-AAAA1111")).resolves.toBe("not-merged");
  });

  it("without the item identity, attested PRs are never read", async () => {
    await expect(resolveMergeSignalFromRefs({
      heads: [], pullRequests: [], attestedPullRequests: [101], roots: [repo.root], now, readTrunkCommittedAt: fresh,
    })).resolves.toBe("not-merged");
  });

  it("the database resolver reads the PR-submit row when no room or evidence link names a PR", async () => {
    const calls: unknown[] = [];
    const db = {
      workroom: { findMany: async () => [] },
      backlogItemActivity: {
        findMany: async (args: { where: { kind: string } }) => {
          calls.push(args);
          return args.where.kind === "status_change" ? [prSubmit(101)] : [];
        },
      },
    };
    await expect(resolveMergeDeliveryFromDb(db, { itemRowId: "row-1", itemId: "BI-AAAA1111", workType: "bug" }, {
      roots: [repo.root], now, readTrunkCommittedAt: fresh,
    })).resolves.toBe("merged");
    expect(calls).toContainEqual(expect.objectContaining({
      where: { backlogItemId: "row-1", kind: "status_change" },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    }));
  });

  it("the database resolver answers signal-unavailable when the read itself fails", async () => {
    const db = {
      workroom: { findMany: async () => { throw new Error("db down"); } },
      backlogItemActivity: { findMany: async () => [] },
    };
    await expect(resolveMergeDeliveryFromDb(db, { itemRowId: "row-1", itemId: "BI-AAAA1111" }, { roots: [repo.root] }))
      .resolves.toBe("signal-unavailable");
  });
});
