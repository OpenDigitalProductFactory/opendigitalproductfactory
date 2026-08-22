import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeCloneOccupancy } from "./shared-clone-occupancy.mjs";

const gitFor = (map) => (args) => {
  if (args.includes("rev-parse")) return map.branch ?? "";
  if (args.includes("status")) return map.status ?? "";
  if (args.includes("worktree")) return map.worktrees ?? "";
  return "";
};

describe("BI-D234C277 — shared clone occupancy", () => {
  it("stays silent in a session's own worktree", () => {
    const r = describeCloneOccupancy("/wt/topic", gitFor({}), () => false);
    assert.equal(r.isRootClone, false);
    assert.deepEqual(r.lines, []);
  });

  it("leads with the shared clone, not with dependency status", () => {
    const r = describeCloneOccupancy(
      "/root",
      gitFor({ branch: "fix/another-session\n", worktrees: "/root  aaa [main]\n/other  bbb [x]\n" }),
      (p) => p === "/root/.git",
    );
    assert.match(r.lines[0], /^SHARED ROOT CLONE/);
    assert.match(r.lines.join("\n"), /on fix\/another-session/);
    assert.match(r.lines.join("\n"), /git worktree add/);
  });

  it("warns off another session's staged work instead of advising a cleanup", () => {
    const text = describeCloneOccupancy(
      "/root",
      gitFor({ branch: "main\n", status: "M  staged.ts\n" }),
      (p) => p === "/root/.git",
    ).lines.join("\n");
    assert.match(text, /another session is mid-work/);
    assert.match(text, /Do not commit, stash, or reset them/);
  });

  it("reads the porcelain columns — an unstaged edit is not another session's staged work", () => {
    const text = describeCloneOccupancy(
      "/root",
      gitFor({ branch: "main\n", status: " M unstaged.ts\n" }),
      (p) => p === "/root/.git",
    ).lines.join("\n");
    assert.doesNotMatch(text, /staged change/);
    assert.match(text, /may not be yours/);
  });

  it("names the reflog blind spot, since nothing else reports it", () => {
    const text = describeCloneOccupancy("/root", gitFor({ branch: "main\n" }), (p) => p === "/root/.git")
      .lines.join("\n");
    assert.match(text, /no reflog entry/);
  });
});
