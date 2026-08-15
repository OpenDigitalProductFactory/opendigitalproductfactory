import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planRootRefresh,
  gatherRootState,
  refreshRootClone,
} from "./root-clone-refresh.mjs";

describe("planRootRefresh", () => {
  it("fast-forwards a clean, on-main, behind root", () => {
    assert.deepEqual(
      planRootRefresh({ detached: false, onMain: true, clean: true, behind: 3 }).action,
      "ff",
    );
  });

  it("skips when already current", () => {
    assert.equal(planRootRefresh({ detached: false, onMain: true, clean: true, behind: 0 }).action, "skip");
  });

  it("refuses when off-main, dirty, or detached — never force-moves the root", () => {
    assert.equal(planRootRefresh({ detached: false, onMain: false, clean: true, behind: 5 }).action, "refuse");
    assert.equal(planRootRefresh({ detached: false, onMain: true, clean: false, behind: 5 }).action, "refuse");
    assert.equal(planRootRefresh({ detached: true, onMain: false, clean: true, behind: 5 }).action, "refuse");
  });
});

/**
 * Scripted fake git: maps a joined-args key to stdout. Any unmatched call returns
 * a non-zero status so gitText/measure treat it as empty.
 */
function fakeGit(map) {
  const calls = [];
  const impl = (_bin, args) => {
    calls.push(args.join(" "));
    const key = args.join(" ");
    for (const [pattern, out] of Object.entries(map)) {
      if (key.includes(pattern)) return { status: 0, stdout: out, stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "" };
  };
  return { impl, calls };
}

describe("gatherRootState", () => {
  it("reads branch, cleanliness, and behind-count", () => {
    const { impl } = fakeGit({
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": "",
      "rev-parse HEAD": "aaa",
      "rev-parse origin/main": "bbb",
      "rev-list --count aaa..bbb": "4",
    });
    const state = gatherRootState("/root", { spawnSyncImpl: impl });
    assert.equal(state.branch, "main");
    assert.equal(state.onMain, true);
    assert.equal(state.detached, false);
    assert.equal(state.clean, true);
    assert.equal(state.behind, 4);
  });

  it("flags a dirty, off-main root", () => {
    const { impl } = fakeGit({
      "rev-parse --abbrev-ref HEAD": "feat/x",
      "status --porcelain": " M file.ts",
      "rev-parse HEAD": "aaa",
      "rev-parse origin/main": "bbb",
      "rev-list --count aaa..bbb": "2",
    });
    const state = gatherRootState("/root", { spawnSyncImpl: impl });
    assert.equal(state.onMain, false);
    assert.equal(state.clean, false);
  });
});

describe("refreshRootClone", () => {
  it("runs a ff-only merge when safe and reports changed", () => {
    const { impl, calls } = fakeGit({
      "fetch origin main": "",
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": "",
      "rev-parse HEAD": "aaa",
      "rev-parse origin/main": "bbb",
      "rev-list --count aaa..bbb": "2",
      "merge --ff-only origin/main": "Updating aaa..bbb",
    });
    const r = refreshRootClone({ rootClonePath: "/root", spawnSyncImpl: impl });
    assert.equal(r.action, "ff");
    assert.equal(r.changed, true);
    assert.ok(calls.some((c) => c.includes("merge --ff-only origin/main")));
  });

  it("does NOT merge a dirty root", () => {
    const { impl, calls } = fakeGit({
      "fetch origin main": "",
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": " M x",
      "rev-parse HEAD": "aaa",
      "rev-parse origin/main": "bbb",
      "rev-list --count aaa..bbb": "2",
    });
    const r = refreshRootClone({ rootClonePath: "/root", spawnSyncImpl: impl });
    assert.equal(r.action, "refuse");
    assert.equal(r.changed, false);
    assert.ok(!calls.some((c) => c.includes("merge --ff-only")));
  });

  it("reports failed when the ff-only merge itself fails", () => {
    const impl = (_bin, args) => {
      const key = args.join(" ");
      if (key.includes("rev-parse --abbrev-ref HEAD")) return { status: 0, stdout: "main", stderr: "" };
      if (key.includes("status --porcelain")) return { status: 0, stdout: "", stderr: "" };
      if (key.endsWith("rev-parse HEAD")) return { status: 0, stdout: "aaa", stderr: "" };
      if (key.includes("rev-parse origin/main")) return { status: 0, stdout: "bbb", stderr: "" };
      if (key.includes("rev-list --count")) return { status: 0, stdout: "2", stderr: "" };
      if (key.includes("merge --ff-only")) return { status: 1, stdout: "", stderr: "not possible to fast-forward" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const r = refreshRootClone({ rootClonePath: "/root", spawnSyncImpl: impl, doFetch: false });
    assert.equal(r.action, "failed");
    assert.equal(r.changed, false);
    assert.match(r.reason, /fast-forward/);
  });
});
