/**
 * BI-1ADD56FC — unit tests for shared-safe git fetch helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertRepoNotShallow,
  fetchOriginMainSharedSafe,
  isShallowRepository,
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
