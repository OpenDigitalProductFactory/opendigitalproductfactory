/**
 * BI-1ADD56FC — unit tests for shared-safe git fetch helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertRepoNotShallow,
  fetchOriginMainSharedSafe,
  isShallowRepository,
  SHALLOW_DEEPEN_MAX_STEPS,
  SHALLOW_DEEPEN_STEP,
  unshallowRootSharedSafe,
} from "./git-fetch-shared-safe.mjs";

describe("isShallowRepository", () => {
  it("is true when rev-parse reports true", () => {
    const git = (args) => {
      if (args.join(" ") === "rev-parse --is-shallow-repository") return "true\n";
      throw new Error(`unexpected ${args}`);
    };
    assert.equal(isShallowRepository(git), true);
  });

  it("is false when rev-parse reports false", () => {
    const git = () => "false\n";
    assert.equal(isShallowRepository(git), false);
  });
});

describe("fetchOriginMainSharedSafe (BI-1ADD56FC)", () => {
  it("never passes --depth when the repo is full", () => {
    /** @type {string[][]} */
    const calls = [];
    const git = (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return "false\n";
      return "";
    };
    const r = fetchOriginMainSharedSafe(git);
    assert.equal(r.mode, "full-fetch");
    const fetchCall = calls.find((c) => c[0] === "fetch");
    assert.ok(fetchCall, "expected a fetch call");
    assert.equal(fetchCall.includes("--depth=1"), false);
    assert.equal(fetchCall.includes("--depth"), false);
    assert.deepEqual(fetchCall, ["fetch", "--no-tags", "origin", "main"]);
  });

  it("allows depth only when already shallow", () => {
    /** @type {string[][]} */
    const calls = [];
    const git = (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return "true\n";
      return "";
    };
    const r = fetchOriginMainSharedSafe(git);
    assert.equal(r.mode, "depth-on-already-shallow");
    const fetchCall = calls.find((c) => c[0] === "fetch");
    assert.ok(fetchCall?.includes("--depth=1"));
  });
});

describe("fetchOriginMainSharedSafe keeps the merge base on a shallow clone", () => {
  /** @param {(calls: string[][]) => boolean} mergeBaseFound */
  function shallowGit(mergeBaseFound) {
    /** @type {string[][]} */
    const calls = [];
    const git = (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return "true\n";
      if (args[0] === "merge-base") return mergeBaseFound(calls) ? "abc123\n" : "";
      return "";
    };
    return { git, calls };
  }
  const deepens = (calls) => calls.filter((c) => c[0] === "fetch" && c.some((a) => a.startsWith("--deepen="))).length;

  it("does not deepen when the depth-1 refresh already shares an ancestor (CI merge ref)", () => {
    const { git, calls } = shallowGit(() => true);
    const r = fetchOriginMainSharedSafe(git);
    assert.equal(r.mode, "depth-on-already-shallow");
    assert.equal(r.deepenedBy, 0);
    assert.equal(deepens(calls), 0);
  });

  it("deepens in steps until a branch cut from an older main finds its merge base", () => {
    const { git, calls } = shallowGit((c) => deepens(c) >= 2);
    const r = fetchOriginMainSharedSafe(git);
    assert.equal(deepens(calls), 2);
    assert.equal(r.deepenedBy, 2 * SHALLOW_DEEPEN_STEP);
    assert.ok(calls.some((c) => c.includes(`--deepen=${SHALLOW_DEEPEN_STEP}`)));
  });

  it("stops deepening at the bound and reports no merge base for an unrelated HEAD", () => {
    const { git, calls } = shallowGit(() => false);
    const r = fetchOriginMainSharedSafe(git);
    assert.equal(deepens(calls), SHALLOW_DEEPEN_MAX_STEPS);
    assert.equal(r.mergeBase, false);
  });

  it("treats a throwing merge-base as no merge base", () => {
    const git = (args) => {
      if (args[0] === "rev-parse") return "true\n";
      if (args[0] === "merge-base") throw new Error("fatal: no merge base");
      return "";
    };
    assert.equal(fetchOriginMainSharedSafe(git).mergeBase, false);
  });
});

describe("assertRepoNotShallow", () => {
  it("throws REPO_IS_SHALLOW with repair guidance when shallow", () => {
    const git = () => "true\n";
    assert.throws(
      () => assertRepoNotShallow(git, { label: "root clone" }),
      (err) => {
        assert.equal(err.code, "REPO_IS_SHALLOW");
        assert.match(err.message, /BI-1ADD56FC/);
        assert.match(err.message, /unshallow/i);
        return true;
      },
    );
  });

  it("passes on a full repository", () => {
    const git = () => "false\n";
    assert.doesNotThrow(() => assertRepoNotShallow(git));
  });
});

describe("unshallowRootSharedSafe (BI-AA2201B0)", () => {
  it("fetches --unshallow origin when the repo is shallow", () => {
    /** @type {string[][]} */
    const calls = [];
    const git = (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return "true\n";
      return "";
    };
    const r = unshallowRootSharedSafe(git);
    assert.equal(r.mode, "unshallowed");
    assert.deepEqual(
      calls.find((c) => c[0] === "fetch"),
      ["fetch", "--unshallow", "origin"],
    );
  });

  it("is a no-op on an already-full repository", () => {
    /** @type {string[][]} */
    const calls = [];
    const git = (args) => {
      calls.push(args);
      return "false\n";
    };
    const r = unshallowRootSharedSafe(git);
    assert.equal(r.mode, "already-full");
    assert.equal(calls.some((c) => c[0] === "fetch"), false);
  });

  it("honors a custom remote", () => {
    const git = (args) => (args[0] === "rev-parse" ? "true\n" : "");
    const calls = [];
    const spyGit = (args) => {
      calls.push(args);
      return git(args);
    };
    unshallowRootSharedSafe(spyGit, { remote: "upstream" });
    assert.deepEqual(
      calls.find((c) => c[0] === "fetch"),
      ["fetch", "--unshallow", "upstream"],
    );
  });
});
