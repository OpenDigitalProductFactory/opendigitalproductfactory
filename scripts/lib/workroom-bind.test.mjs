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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  activityKindForBranch,
  bindWorktreeToWorkroom as bindWithConfiguredCredentials,
  markerFromAdoption,
  planAdoption,
  resolveMcpAccess,
  resolveSessionRef,
  resolveWorktreeSourceIdentity,
  toPosixPath,
} from "./workroom-bind.mjs";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
const absentCredentialsFile = join(tmpdir(), `dpf-binder-absent-${process.pid}.json`);
// Unit fixtures must never load the user's real headless credential file.
const fixtureEnv = (env = {}) => ({ DPF_MCP_CLIENT_CREDENTIALS_FILE: absentCredentialsFile, ...env });
const bindWorktreeToWorkroom = input => bindWithConfiguredCredentials({ ...input, env: fixtureEnv(input.env) });

test("headless OAuth credentials are consumed before a legacy PAT without changing the endpoint", () => {
  const access = resolveMcpAccess({
    DPF_MCP_ENDPOINT: "https://localhost/api/mcp/v1?tier=full",
    DPF_MCP_CLIENT_ID: "fixture-client", DPF_MCP_CLIENT_SECRET: "fixture-secret",
    DPF_MCP_BEARER_TOKEN: "fixture-pat",
  });
  assert.equal(access?.mcpUrl, "https://localhost/api/mcp/v1?tier=full");
  assert.equal(access?.bearerToken.kind, "client_credentials");
  assert.equal(typeof access.bearerToken.get, "function");
});

test("a configured headless credential file is consumed and malformed credentials never fall back to PAT", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-binder-credentials-"));
  const file = join(dir, "credentials.json");
  try {
    writeFileSync(file, JSON.stringify({ clientId: "fixture-client", clientSecret: "fixture-secret" }));
    const env = { DPF_MCP_CLIENT_CREDENTIALS_FILE: file, DPF_MCP_BEARER_TOKEN: "fixture-pat" };
    assert.equal(resolveMcpAccess(env)?.bearerToken.kind, "client_credentials");
    writeFileSync(file, "invalid fixture content");
    assert.equal(resolveMcpAccess(env), null);
    assert.equal(resolveMcpAccess({ ...env, DPF_MCP_CLIENT_ID: "half-configured" }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("invalid headless credential configuration is unavailable before adoption and writes no marker", async () => {
  let called = false, wrote = false;
  const result = await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: "/git", repositoryFullName: REPO,
    env: { DPF_MCP_CLIENT_ID: "fixture-client", DPF_MCP_BEARER_TOKEN: "fixture-pat" },
    call: async () => { called = true; return capsule(); }, writeMarker: () => { wrote = true; },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(called, false);
  assert.equal(wrote, false);
});

test("automatic adoption retains both observed full commit identities", () => {
  const baseSha = "1".repeat(40);
  const headSha = "2".repeat(40);
  const result = planAdoption({ branch: "fix/a", worktreePath: "/wt/a", repositoryFullName: REPO, baseSha, headSha });
  assert.equal(result.baseSha, baseSha);
  assert.equal(result.headSha, headSha);
});

test("local identity capture uses the actual Git merge base, not the current base tip or head", async () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-source-identity-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10000 }).trim();
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    git("remote", "add", "origin", `https://github.com/${REPO}.git`);
    writeFileSync(join(root, "base.txt"), "base"); git("add", "."); git("commit", "--quiet", "-m", "base");
    const baseSha = git("rev-parse", "HEAD");
    git("switch", "--quiet", "-c", "fix/fixture");
    writeFileSync(join(root, "topic.txt"), "topic"); git("add", "."); git("commit", "--quiet", "-m", "topic");
    const headSha = git("rev-parse", "HEAD");
    git("switch", "--quiet", "main");
    writeFileSync(join(root, "main.txt"), "main"); git("add", "."); git("commit", "--quiet", "-m", "advanced main");
    git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
    git("switch", "--quiet", "fix/fixture");
    const observed = resolveWorktreeSourceIdentity(root);
    assert.equal(observed.ok, true, observed.reason);
    assert.equal(observed.identity.baseSha, baseSha);
    assert.equal(observed.identity.headSha, headSha);
    assert.equal(observed.identity.branch, "fix/fixture");
    assert.equal(observed.identity.repositoryFullName, REPO);
    assert.equal(observed.identity.worktreePath, toPosixPath(git("rev-parse", "--show-toplevel")));
    let sent;
    const binding = await bindWorktreeToWorkroom({ branch: "fix/fixture", worktreePath: root,
      captureSourceIdentity: true, env: { DPF_MCP_BEARER_TOKEN: "fixture" },
      call: async (_tool, args) => { sent = args; return capsule({ ...args, leaseExpiresAt: new Date(Date.now() + 60000).toISOString() }); } });
    assert.equal(binding.status, "bound", binding.reason);
    assert.equal(sent.baseSha, baseSha);
    assert.equal(sent.headSha, headSha);
    git("update-ref", "-d", "refs/remotes/origin/main");
    assert.equal(resolveWorktreeSourceIdentity(root).ok, false, "missing remote base history must not substitute HEAD");
    git("switch", "--quiet", "--detach", headSha);
    assert.equal(resolveWorktreeSourceIdentity(root).ok, false, "detached HEAD has no claim branch");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("identity observation stops at its total deadline and rejects late complete data", () => {
  let elapsed = 0, calls = 0;
  const result = resolveWorktreeSourceIdentity("/wt/a", { now: () => elapsed,
    readGit: (_args, opts) => { calls++; assert.equal(opts.timeout, 10000); elapsed = 10000; return "fix/a"; } });
  assert.equal(result.ok, false); assert.equal(calls, 1);
});

const observedIdentity = { repositoryFullName: REPO, branch: "fix/a", worktreePath: "/wt/a", baseBranch: "main", baseSha: "1".repeat(40), headSha: "2".repeat(40) };

test("source movement during admission prevents caching an old authoritative identity", async () => {
  let observations = 0, writes = 0;
  const result = await bindWorktreeToWorkroom({ branch: "fix/a", worktreePath: "/wt/a", gitDir: "/git", captureSourceIdentity: true,
    observeIdentity: () => ({ ok: true, identity: { ...observedIdentity, headSha: ++observations === 1 ? observedIdentity.headSha : "3".repeat(40) } }),
    env: { DPF_MCP_BEARER_TOKEN: "fixture" }, call: async () => capsule({ ...observedIdentity, headBranch: observedIdentity.branch }),
    writeMarker: () => { writes++; } });
  assert.equal(result.status, "error"); assert.equal(writes, 0); assert.equal(observations, 2);
});

test("automatic binding stops before admission when local identity is unavailable or the branch conflicts", async () => {
  for (const observation of [{ ok: false, reason: "base history unavailable" }, { ok: true, identity: { ...observedIdentity, branch: "fix/other" } }]) {
    let calls = 0, writes = 0;
    const result = await bindWorktreeToWorkroom({ branch: "fix/a", worktreePath: "/wt/a", captureSourceIdentity: true,
      observeIdentity: () => observation, env: { DPF_MCP_BEARER_TOKEN: "fixture" },
      call: async () => { calls++; return capsule(); }, writeMarker: () => { writes++; } });
    assert.equal(result.status, "unavailable"); assert.equal(calls, 0); assert.equal(writes, 0);
  }
});

test("automatic binding validates the authoritative full source identity before caching", async () => {
  const returned = { ...observedIdentity, headBranch: observedIdentity.branch };
  for (const patch of [{}, { baseSha: null }, { headSha: "3".repeat(40) }, { repositoryFullName: "other/repo" }, { headBranch: "fix/other" }, { worktreePath: "/wt/other" }, { baseBranch: "other" }]) {
    let writes = 0;
    const result = await bindWorktreeToWorkroom({ branch: "fix/a", worktreePath: "/wt/a", gitDir: "/git", captureSourceIdentity: true,
      observeIdentity: () => ({ ok: true, identity: observedIdentity }), env: { DPF_MCP_BEARER_TOKEN: "fixture" },
      call: async (_tool, args) => { assert.equal(args.baseSha, observedIdentity.baseSha); assert.equal(args.headSha, observedIdentity.headSha); return capsule({ ...returned, ...patch }); },
      writeMarker: () => { writes++; } });
    const exact = Object.keys(patch).length === 0;
    assert.equal(result.status, exact ? "bound" : "error", JSON.stringify(patch));
    assert.equal(writes, exact ? 1 : 0);
  }
});

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
  assert.equal(resolveMcpAccess(fixtureEnv()), null);
  const a = resolveMcpAccess(fixtureEnv({ DPF_MCP_BEARER_TOKEN: "t" }));
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

// ── session identity (executorRef) ───────────────────────────────────────────
//
// A claim guard that can prove a live claim COVERS a branch, but not that it is
// THIS session's, enforces a weaker property than AGENTS.md 12 states: two
// sessions on one branch would both pass. claim_backlog_item_for_work has
// required sessionRef for exactly this reason; adopt_worktree omitted it.

test("a host-provided session id is preferred over the fallback", () => {
  for (const key of ["DPF_SESSION_REF", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "CODEX_SESSION_ID", "GROK_SESSION_ID"]) {
    assert.equal(resolveSessionRef({ worktreePath: "/wt/a", env: { [key]: "sess-1" } }), "sess-1", key);
  }
});

test("with no host session id, the worktree path is the identity — weaker but truthful", () => {
  // Stable for the life of the tree and unique across trees. Not a real session
  // id, but better than null, which is what every adopted worktree stored before.
  assert.equal(resolveSessionRef({ worktreePath: "D:\\wt\\a", env: {} }), "worktree:D:/wt/a");
});

test("with neither, the session ref is null rather than invented", () => {
  assert.equal(resolveSessionRef({ worktreePath: null, env: {} }), null);
});

test("planAdoption sends sessionRef when there is one, and omits it when there is not", () => {
  const withRef = planAdoption({ branch: "fix/a", worktreePath: "/wt/a", repositoryFullName: REPO, sessionRef: "s1" });
  assert.equal(withRef.sessionRef, "s1");
  const without = planAdoption({ branch: "fix/a", worktreePath: "/wt/a", repositoryFullName: REPO });
  assert.ok(!("sessionRef" in without), "an absent session ref must not be sent as null");
});

test("binding threads the resolved session ref through to adopt_worktree", async () => {
  let sent = null;
  await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: null, repositoryFullName: REPO,
    env: { DPF_MCP_BEARER_TOKEN: "t", DPF_SESSION_REF: "sess-xyz" },
    call: async (_tool, args) => { sent = args; return capsule(); },
  });
  assert.equal(sent.sessionRef, "sess-xyz");
});

// ── BI-144E4F92 / BI-4BEEC539: re-caching the caller's own claim ─────────────
//
// Claude Code exports CLAUDE_CODE_SESSION_ID, not CLAUDE_SESSION_ID. The bind
// sent `worktree:<path>` as the session, so adopt_worktree saw a different
// session from the one that claimed the branch (claim_backlog_item_for_work
// stores the real session id) and refused it as occupied. A correctly claimed
// worktree, or one whose lease heartbeat_workroom renewed, could not be
// re-cached, and the claim guard denied every edit.

/** adopt_worktree as the server decides it: reuse a live capsule for the same session. */
function serverWithCapsuleOwnedBy(ownerSession) {
  return async (_tool, args) => {
    if (args.sessionRef !== ownerSession) {
      return {
        success: false,
        error: "branch_occupied",
        message: `Branch ${args.headBranch} is already bound to Work Capsule WC-OWNED1 (ready, BI-OWNED1). Resume BI-OWNED1 on that capsule, or use a different branch.`,
      };
    }
    return capsule({ capsuleId: "WC-OWNED1" });
  };
}

test("a Claude session re-caches the claim it already holds, so the guard can allow", async () => {
  const gitDir = mkdtempSync(join(tmpdir(), "dpf-bind-own-"));
  try {
    const r = await bindWorktreeToWorkroom({
      branch: "fix/a", worktreePath: "/wt/a", gitDir, repositoryFullName: REPO,
      env: { DPF_MCP_BEARER_TOKEN: "t", CLAUDE_CODE_SESSION_ID: "sess-claude" },
      call: serverWithCapsuleOwnedBy("sess-claude"),
    });
    assert.equal(r.status, "bound", r.reason);
    assert.equal(JSON.parse(readFileSync(join(gitDir, "dpf-workroom-claim.json"), "utf8")).capsuleId, "WC-OWNED1");
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});

test("another session's claim is still refused and no marker is written", async () => {
  const gitDir = mkdtempSync(join(tmpdir(), "dpf-bind-foreign-"));
  try {
    const r = await bindWorktreeToWorkroom({
      branch: "fix/a", worktreePath: "/wt/a", gitDir, repositoryFullName: REPO,
      env: { DPF_MCP_BEARER_TOKEN: "t", CLAUDE_CODE_SESSION_ID: "sess-other" },
      call: serverWithCapsuleOwnedBy("sess-claude"),
    });
    assert.equal(r.status, "refused");
    assert.throws(() => readFileSync(join(gitDir, "dpf-workroom-claim.json"), "utf8"));
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});

// ── BI-EFCDE989: the claim's identity and the CLI's identity can differ ──────
//
// claim_backlog_item_for_work is often called with sessionRef
// `worktree:<path>` (the form its refusals suggest). Inside Claude Code the CLI
// then sends CLAUDE_CODE_SESSION_ID, the server sees another session, and the
// caller's own claim is refused. The CLI now tries each identity it can
// truthfully present, host session first, and stops at the first acceptance.

test("a claim recorded under the worktree identity is re-cached from inside a Claude session", async () => {
  const gitDir = mkdtempSync(join(tmpdir(), "dpf-bind-wtref-"));
  const sent = [];
  try {
    const owner = serverWithCapsuleOwnedBy("worktree:/wt/a");
    const r = await bindWorktreeToWorkroom({
      branch: "fix/a", worktreePath: "/wt/a", gitDir, repositoryFullName: REPO,
      env: { DPF_MCP_BEARER_TOKEN: "t", CLAUDE_CODE_SESSION_ID: "sess-claude" },
      call: async (tool, args) => { sent.push(args.sessionRef); return owner(tool, args); },
    });
    assert.equal(r.status, "bound", r.reason);
    assert.deepEqual(sent, ["sess-claude", "worktree:/wt/a"], "host identity first, worktree identity second");
    assert.equal(JSON.parse(readFileSync(join(gitDir, "dpf-workroom-claim.json"), "utf8")).capsuleId, "WC-OWNED1");
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});

test("a claim held under neither of this session's identities is still refused", async () => {
  const gitDir = mkdtempSync(join(tmpdir(), "dpf-bind-neither-"));
  const sent = [];
  try {
    const owner = serverWithCapsuleOwnedBy("sess-someone-else");
    const r = await bindWorktreeToWorkroom({
      branch: "fix/a", worktreePath: "/wt/a", gitDir, repositoryFullName: REPO,
      env: { DPF_MCP_BEARER_TOKEN: "t", CLAUDE_CODE_SESSION_ID: "sess-claude" },
      call: async (tool, args) => { sent.push(args.sessionRef); return owner(tool, args); },
    });
    assert.equal(r.status, "refused");
    assert.match(r.reason, /already bound/);
    assert.equal(sent.length, 2, "both identities tried, nothing more");
    assert.throws(() => readFileSync(join(gitDir, "dpf-workroom-claim.json"), "utf8"));
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});

test("a refusal that is not about occupancy is not retried under another identity", async () => {
  const sent = [];
  const r = await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: null, repositoryFullName: REPO,
    env: { DPF_MCP_BEARER_TOKEN: "t", CLAUDE_CODE_SESSION_ID: "sess-claude" },
    call: async (_tool, args) => { sent.push(args.sessionRef); return { success: false, error: "portal_quiescing", message: "writes refused" }; },
  });
  assert.equal(r.status, "refused");
  assert.deepEqual(sent, ["sess-claude"]);
});

test("with only one identity available, exactly one call is made", async () => {
  const sent = [];
  await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: null, repositoryFullName: REPO,
    env: { DPF_MCP_BEARER_TOKEN: "t" },
    call: async (_tool, args) => { sent.push(args.sessionRef); return { success: false, error: "branch_occupied", message: "already bound" }; },
  });
  assert.deepEqual(sent, ["worktree:/wt/a"]);
});

// BI-D1FB8C4D: provisioning binds before the worktree exists, so the binder
// hands back the marker for the caller to cache later, and keeps the refusal
// code so an authorization answer is never mistaken for an outage.
test("binding with no gitDir yet returns the marker for the caller to cache", async () => {
  const r = await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: null, repositoryFullName: REPO,
    env: { DPF_MCP_BEARER_TOKEN: "t" },
    call: async () => capsule(),
  });
  assert.equal(r.status, "bound");
  assert.equal(r.marker.capsuleId, "WC-ABC123");
  assert.equal(r.marker.branch, "fix/a");
});

test("a refusal carries the server's error code", async () => {
  const r = await bindWorktreeToWorkroom({
    branch: "fix/a", worktreePath: "/wt/a", gitDir: null, repositoryFullName: REPO,
    env: { DPF_MCP_BEARER_TOKEN: "t" },
    call: async () => ({ success: false, error: "worktree_provision_not_admitted", message: "Workroom WC-9 runs on source-inquiry@1.0.0" }),
  });
  assert.equal(r.status, "refused");
  assert.equal(r.code, "worktree_provision_not_admitted");
});
