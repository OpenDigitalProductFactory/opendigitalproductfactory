// The platform's answer to where its development surfaces work must be stable
// and its provenance legible: a wrong base points the reaper at the wrong
// directory, so "which rule decided this" is part of the answer.
//
// Spec: docs/superpowers/specs/2026-09-02-platform-owned-client-configuration-design.md §1

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve, sep } from "node:path";

import { resolveWorktreeBase, WORKTREE_BASE_ENV } from "./worktree-base.mjs";

const ROOT_CLONE = resolve(`${sep}srv`, "dpf-source-root");
const DECLARED = resolve(`${sep}srv`, "declared-worktrees");
const OVERRIDE = resolve(`${sep}srv`, "override-worktrees");

describe("resolveWorktreeBase", () => {
  it("derives the historical location when nothing is declared", () => {
    // Every existing install must keep working with no operator action, so the
    // derived default has to reproduce exactly what callers computed before.
    const { base, source } = resolveWorktreeBase({ rootClone: ROOT_CLONE, env: {} });
    assert.equal(base, join(dirname(ROOT_CLONE), "dpf-source-root-worktrees"));
    assert.equal(source, "derived");
  });

  it("prefers what the install declares over everything else", () => {
    const { base, source } = resolveWorktreeBase({
      rootClone: ROOT_CLONE,
      env: { [WORKTREE_BASE_ENV]: OVERRIDE },
      installConfig: DECLARED,
    });
    assert.equal(base, DECLARED);
    assert.equal(source, "install-config");
  });

  it("honours the operator override when the install declares nothing", () => {
    const { base, source } = resolveWorktreeBase({
      rootClone: ROOT_CLONE,
      env: { [WORKTREE_BASE_ENV]: OVERRIDE },
    });
    assert.equal(base, OVERRIDE);
    assert.equal(source, "env");
  });

  it("treats a blank declaration or override as absent, not as an empty path", () => {
    // A blank env var is the common accident. Reading it as "" would resolve to
    // the process working directory and aim the reaper at whatever that is.
    const { base, source } = resolveWorktreeBase({
      rootClone: ROOT_CLONE,
      env: { [WORKTREE_BASE_ENV]: "   " },
      installConfig: "",
    });
    assert.equal(base, join(dirname(ROOT_CLONE), "dpf-source-root-worktrees"));
    assert.equal(source, "derived");
  });

  it("refuses a relative base rather than resolving it per caller", () => {
    // The portal, a script and a client planner all run from different working
    // directories; a relative base would silently mean three different places.
    assert.throws(
      () => resolveWorktreeBase({ rootClone: ROOT_CLONE, installConfig: "./worktrees" }),
      /must be an absolute path/,
    );
  });

  it("requires a root clone", () => {
    assert.throws(() => resolveWorktreeBase({ rootClone: "" }), /rootClone is required/);
  });

  it("reports provenance for every branch, so an unexpected base is explainable", () => {
    const sources = [
      resolveWorktreeBase({ rootClone: ROOT_CLONE, installConfig: DECLARED }).source,
      resolveWorktreeBase({ rootClone: ROOT_CLONE, env: { [WORKTREE_BASE_ENV]: OVERRIDE } }).source,
      resolveWorktreeBase({ rootClone: ROOT_CLONE, env: {} }).source,
    ];
    assert.deepEqual(sources, ["install-config", "env", "derived"]);
  });
});
