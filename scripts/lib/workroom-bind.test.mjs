// scripts/lib/workroom-bind.test.mjs
//
// BI-0B292D84 layer 1 — binding must happen as a side effect of creating a
// worktree, not as something an agent remembers.
//
// Measured 2026-08-27: 31 of 91 live worktree branches had no Workroom binding,
// unchanged since the rule was written, because a rule that asks you to
// remember something at the moment you are thinking about something else is not
// a control. A guard that warns makes the gap audible; only binding closes it.
//
// Run: node --test scripts/lib/workroom-bind.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  activityKindForBranch,
  bindWorktreeToWorkroom,
  markerFromAdoption,
  planAdoption,
  resolveMcpAccess,
  toPosixPath,
} from "./workroom-bind.mjs";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

// The REAL wire shape returned by mcpCall for adopt_worktree:
// {success, message, entityId, data:{capsule}}. Tests originally used the
// assumed shape {capsule} and passed while every live bind failed — the same
// class of miss as a guard that passes its unit tests while inert.
function capsule(over = {}) {
  return {
    success: true,
    entityId: over.capsuleId ?? "WC-ABC123",
    data: { capsule: {
      capsuleId: "WC-ABC123",
      leaseExpiresAt: "2026-08-28T02:00:00.000Z",
      worktreePath: "D:/wt/x",
      backlogItemId: "BI-1",
      ...over,
    } },
  };
}

/** The legacy/unwrapped shape, kept working by the fallbacks. */
function bareCapsule(over = {}) {
  return { capsule: { capsuleId: "WC-ABC123", leaseExpiresAt: "2026-08-28T02:00:00.000Z", ...over } };
}

// ── path shape ───────────────────────────────────────────────────────────────

test("worktree paths are recorded forward-slashed, the way the substrate stores them", () => {
  assert.equal(toPosixPath("D:\\DPF-worktrees\\a"), "D:/DPF-worktrees/a");
  assert.equal(toPosixPath("/already/posix"), "/already/posix");
  assert.equal(toPosixPath(null), "");
});

// ── the branch prefix already says what kind of work it is ───────────────────

test("activity kind is derived from the branch intent prefix, so binding needs no interaction", () => {
  assert.equal(activityKindForBranch("fix/a"), "remediation");
  assert.equal(activityKindForBranch("hotfix/a"), "remediation");
  assert.equal(activityKindForBranch("doc/a"), "governance");
  assert.equal(activityKindForBranch("chore/a"), "improvement");
  assert.equal(activityKindForBranch("refactor/a"), "improvement");
  assert.equal(activityKindForBranch("feat/a"), "delivery");
  assert.equal(activityKindForBranch("anything-else"), "delivery");
});

test("adoption arguments carry the branch, worktree and repo identity", () => {
  const p = planAdoption({ branch: "fix/gate-is-dead", worktreePath: "D:\\wt\\g", repositoryFullName: REPO, headSha: "abc123" });
  assert.equal(p.headBranch, "fix/gate-is-dead");
  assert.equal(p.worktreePath, "D:/wt/g");
  assert.equal(p.repositoryFullName, REPO);
  assert.equal(p.headSha, "abc123");
  assert.equal(p.activityKind, "remediation");
  assert.match(p.title, /Gate is dead/);
  // The objective is an honest placeholder, not invented specificity.
  assert.match(p.objective, /Bound automatically at worktree creation/);
});

test("a missing headSha is omitted rather than sent as null", () => {
  const p = planAdoption({ branch: "feat/a", worktreePath: "/wt/a", repositoryFullName: REPO });
  assert.ok(!("headSha" in p));
});

// ── a marker is PROOF, so it is never written speculatively ──────────────────

test("a usable capsule becomes the marker the claim guard reads", () => {
  const m = markerFromAdoption(capsule(), "fix/a");
  assert.equal(m.capsuleId, "WC-ABC123");
  assert.equal(m.branch, "fix/a");
  assert.equal(m.leaseExpiresAt, "2026-08-28T02:00:00.000Z");
});

test("the marker is read from the REAL wire shape, data.capsule, not payload.capsule", () => {
  // Regression: this function was written against {capsule} while the server
  // sends {success, data:{capsule}}. Unit tests using the assumed shape passed
  // while 79 of 91 live binds reported "no usable capsule identity".
  const m = markerFromAdoption(capsule(), "fix/a");
  assert.equal(m.capsuleId, "WC-ABC123");
});

test("the older unwrapped shape still resolves, so the fallback is not decorative", () => {
  assert.equal(markerFromAdoption(bareCapsule(), "fix/a").capsuleId, "WC-ABC123");
});

test("a response with no capsuleId or no lease NEVER becomes a marker", () => {
  // The guard treats a marker as proof a claim exists. Writing one from an
  // ambiguous response would manufacture that proof.
  for (const bad of [
    capsule({ capsuleId: undefined }),
    capsule({ leaseExpiresAt: undefined }),
    capsule({ leaseExpiresAt: "not-a-date" }),
    {},
    null,
  ]) {
    assert.equal(markerFromAdoption(bad, "fix/a"), null, JSON.stringify(bad));
  }
});

// ── degradation ──────────────────────────────────────────────────────────────

test("no token means binding is unavailable, not silently skipped", () => {
  assert.equal(resolveMcpAccess({}), null);
  const a = resolveMcpAccess({ DPF_MCP_BEARER_TOKEN: "t" });
  assert.equal(a.bearerToken, "t");
  assert.match(a.mcpUrl, /api\/mcp\/v1/);
});

test("binding reports unavailable when no token is configured, and writes nothing", async () => {
  let wrote = false;
  const r = await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: "/git", repositoryFullName: REPO,
    env: {}, call: async () => capsule(), writeMarker: () => { wrote = true; },
  });
  assert.equal(r.status, "unavailable");
  assert.equal(wrote, false, "no claim exists, so no marker may be written");
});

test("an unreachable coordination plane degrades and never throws", async () => {
  const r = await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: "/git", repositoryFullName: REPO,
    env: { DPF_MCP_BEARER_TOKEN: "t" },
    call: async () => { throw new Error("ECONNREFUSED"); },
    writeMarker: () => { throw new Error("should not be reached"); },
  });
  assert.equal(r.status, "unavailable");
  assert.match(r.reason, /ECONNREFUSED/);
});

test("a refusal from adopt_worktree is reported as a refusal, not retried as a failure", async () => {
  const r = await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: "/git", repositoryFullName: REPO,
    env: { DPF_MCP_BEARER_TOKEN: "t" },
    call: async () => ({ success: false, error: "branch_occupied", message: "branch already bound elsewhere" }),
    writeMarker: () => { throw new Error("should not be reached"); },
  });
  assert.equal(r.status, "refused");
  assert.match(r.reason, /branch_occupied|already bound/);
});

// ── the happy path actually writes the marker ────────────────────────────────

test("a successful claim is cached as the marker, on disk, in the given git dir", async () => {
  const gitDir = mkdtempSync(join(tmpdir(), "dpf-bind-"));
  try {
    const r = await bindWorktreeToWorkroom({
      branch: "fix/a", worktreePath: "/wt/a", gitDir, repositoryFullName: REPO,
      env: { DPF_MCP_BEARER_TOKEN: "t" },
      call: async (tool, args) => {
        assert.equal(tool, "adopt_worktree");
        assert.equal(args.headBranch, "fix/a");
        return capsule();
      },
    });
    assert.equal(r.status, "bound");
    assert.equal(r.capsuleId, "WC-ABC123");
    const written = JSON.parse(readFileSync(join(gitDir, "dpf-workroom-claim.json"), "utf8"));
    assert.equal(written.capsuleId, "WC-ABC123");
    assert.equal(written.branch, "fix/a");
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});

test("a claim that succeeded but could not be cached still reports bound", async () => {
  // The claim EXISTS in MCP; only the local cache failed. Reporting failure
  // would understate the truth and invite a duplicate claim.
  const r = await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: "/git", repositoryFullName: REPO,
    env: { DPF_MCP_BEARER_TOKEN: "t" },
    call: async () => capsule(),
    writeMarker: () => { throw new Error("EACCES"); },
  });
  assert.equal(r.status, "bound");
  assert.match(r.reason, /marker not cached/);
});
