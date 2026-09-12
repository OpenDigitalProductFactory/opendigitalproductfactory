/**
 * BI-043946C5 — the merge-delivery signal driven against REAL git repositories.
 *
 * Every existing test of this path injects `resolveMergeDelivery`, so the shipped
 * probe was never executed by the suite. It had been returning a silent,
 * unconditional negative on the live install for as long as its candidate roots
 * contained no checkout, and the suite stayed green throughout, because the only
 * thing it ever exercised was the stub.
 *
 * So these tests create actual repositories with `git`. The defect lived in the
 * boundary between this module and git, and a mock of that boundary is exactly
 * what hid it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveMergeSignalFromRefs } from "./backlog-terminal-transition";

const execFileAsync = promisify(execFile);

type Fixture = { root: string; mergedSha: string; unmergedSha: string };

async function git(root: string, ...args: string[]) {
  return execFileAsync("git", ["-C", root, ...args], { windowsHide: true });
}

/** A repository with one commit on the trunk and one commit that never landed. */
async function makeRepo(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "dpf-merge-signal-"));
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "commit.gpgsign", "false");

  await writeFile(path.join(root, "a.txt"), "one\n");
  await git(root, "add", ".");
  // The trunk subject carries the shape the merge queue writes, so the
  // pull-request branch of the probe has something real to match.
  await git(root, "commit", "-m", "feat: land the thing (#4242)");
  const mergedSha = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  // origin/main is the ref the probe reads.
  await git(root, "update-ref", "refs/remotes/origin/main", mergedSha);

  await git(root, "checkout", "-q", "-b", "side");
  await writeFile(path.join(root, "b.txt"), "two\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "wip: never merged");
  const unmergedSha = (await git(root, "rev-parse", "HEAD")).stdout.trim();

  return { root, mergedSha, unmergedSha };
}

describe("merge-delivery signal against real repositories (BI-043946C5)", () => {
  let repo: Fixture;
  let notARepo: string;

  beforeAll(async () => {
    repo = await makeRepo();
    notARepo = await mkdtemp(path.join(tmpdir(), "dpf-no-repo-"));
    await writeFile(path.join(notARepo, ".env"), "PORT=3000\n");
  });

  afterAll(async () => {
    await rm(repo.root, { recursive: true, force: true }).catch(() => {});
    await rm(notARepo, { recursive: true, force: true }).catch(() => {});
  });

  it("reports signal-unavailable when the only root is a directory but not a repository", async () => {
    // The live-install shape exactly: the probe's first root is the INSTALLED
    // runtime directory, so it exists, is readable, and is not a checkout.
    // Before the fix this answered false, indistinguishable from "never merged".
    await expect(resolveMergeSignalFromRefs({
      heads: [repo.mergedSha],
      pullRequests: [4242],
      roots: [notARepo],
    })).resolves.toBe("signal-unavailable");
  });

  it("reports signal-unavailable when there are no candidate roots at all", async () => {
    await expect(resolveMergeSignalFromRefs({
      heads: [repo.mergedSha],
      pullRequests: [],
      roots: [],
    })).resolves.toBe("signal-unavailable");
  });

  it("reports merged when a Workroom head is an ancestor of the trunk", async () => {
    await expect(resolveMergeSignalFromRefs({
      heads: [repo.mergedSha],
      pullRequests: [],
      roots: [repo.root],
    })).resolves.toBe("merged");
  });

  it("reports merged from a linked pull request when no room recorded a head", async () => {
    await expect(resolveMergeSignalFromRefs({
      heads: [],
      pullRequests: [4242],
      roots: [repo.root],
    })).resolves.toBe("merged");
  });

  it("skips an unreadable root and still answers from a later readable one", async () => {
    await expect(resolveMergeSignalFromRefs({
      heads: [repo.mergedSha],
      pullRequests: [],
      roots: [notARepo, repo.root],
    })).resolves.toBe("merged");
  });

  it("reports not-merged when git answers definitively that the head never landed", async () => {
    await expect(resolveMergeSignalFromRefs({
      heads: [repo.unmergedSha],
      pullRequests: [],
      roots: [repo.root],
    })).resolves.toBe("not-merged");
  });

  it("reports signal-unavailable when the repository cannot resolve the head at all", async () => {
    // A sha this clone has never fetched is indeterminate, not a negative: git
    // cannot say whether it is an ancestor of a commit it does not have.
    await expect(resolveMergeSignalFromRefs({
      heads: ["0123456789012345678901234567890123456789"],
      pullRequests: [],
      roots: [repo.root],
    })).resolves.toBe("signal-unavailable");
  });

  it("reports not-merged when the item has no branch identity to look for", async () => {
    // No room head and no linked PR is a fact about the ITEM, not a broken probe.
    await expect(resolveMergeSignalFromRefs({
      heads: [],
      pullRequests: [],
      roots: [repo.root],
    })).resolves.toBe("not-merged");
  });
});

describe("mergeSignalRoots (BI-043946C5)", () => {
  it("puts the configured roots ahead of the built-in fallbacks", async () => {
    const { mergeSignalRoots } = await import("./backlog-terminal-transition");
    const savedRepoRoot = process.env.DPF_REPO_ROOT;
    const savedSourceRoot = process.env.DPF_HOST_SOURCE_ROOT;
    try {
      process.env.DPF_REPO_ROOT = "/configured-a";
      process.env.DPF_HOST_SOURCE_ROOT = "/configured-b";
      const roots = mergeSignalRoots();
      expect(roots[0]).toBe("/configured-a");
      expect(roots[1]).toBe("/configured-b");
      expect(roots).toContain("/host-dpf");
    } finally {
      if (savedRepoRoot === undefined) delete process.env.DPF_REPO_ROOT;
      else process.env.DPF_REPO_ROOT = savedRepoRoot;
      if (savedSourceRoot === undefined) delete process.env.DPF_HOST_SOURCE_ROOT;
      else process.env.DPF_HOST_SOURCE_ROOT = savedSourceRoot;
    }
  });
});
