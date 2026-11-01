import assert from "node:assert/strict";
import { test } from "node:test";

import { bindWorktreeToWorkroom } from "./workroom-bind.mjs";
import { mcpCall } from "./mcp-client.mjs";
import { createClientCredentialsBearer, exchangeClientCredentials } from "./mcp-credential.mjs";

import { BREAK_GLASS_ENV, provisionWorktree } from "./worktree-provision.mjs";

// BI-D1FB8C4D AC-WPG-6..8: admit and bind BEFORE the worktree exists, fail closed,
// and the break-glass applies only when the platform cannot be asked.

const plan = { target: "D:/DPF-worktrees/feat-x", branch: "feat-x" };
const marker = { capsuleId: "WC-1", branch: "feat-x", leaseExpiresAt: "2099-01-01T00:00:00.000Z", worktreePath: plan.target, backlogItemId: null };

function recorder(bindResult, { addThrows = false, afterResult = { status: "bound" } } = {}) {
  const calls = [];
  const effects = {
    bind: async (args) => {
      calls.push(["bind", args.gitDir, args.worktreePath, args.branch]);
      return bindResult;
    },
    addWorktree: (root, target, branch) => {
      calls.push(["add", target, branch]);
      if (addThrows) throw new Error("branch is already checked out");
      return target;
    },
    resolveGitDir: () => "D:/DPF/.git/worktrees/feat-x",
    repositoryFullNameOf: () => "o/r",
    afterCreate: async ({ worktreePath }) => { calls.push(["after", worktreePath]); return afterResult; },
    writePendingMarker: (gitDir, record) => calls.push(["pending-marker", gitDir, record.reason]),
    now: () => new Date("2026-10-27T00:00:00.000Z"),
  };
  return { calls, effects };
}

test("admitted: binds first with no gitDir, then creates, then records source identity", async () => {
  const { calls, effects } = recorder({ status: "bound", capsuleId: "WC-1", marker });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: {}, effects });
  assert.deepEqual(out, { status: "created", path: plan.target, capsuleId: "WC-1" });
  assert.deepEqual(calls.map((c) => c[0]), ["bind", "add", "after"]);
  assert.equal(calls[0][1], null, "nothing exists on disk when the platform is asked");
});

test("refused: nothing is created, and the message names the code and the source-read tools", async () => {
  const { calls, effects } = recorder({ status: "refused", code: "worktree_provision_not_admitted", reason: "Workroom WC-9 runs on source-inquiry@1.0.0" });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: {}, effects });
  assert.equal(out.status, "refused");
  assert.equal(out.code, "worktree_provision_not_admitted");
  assert.match(out.message, /WC-9/);
  assert.match(out.message, /read_source_at_version/);
  assert.deepEqual(calls.map((c) => c[0]), ["bind"]);
});

test("break-glass never overrides a refusal", async () => {
  const { calls, effects } = recorder({ status: "refused", code: "worktree_provision_not_admitted", reason: "read-only room" });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: { [BREAK_GLASS_ENV]: "portal down" }, effects });
  assert.equal(out.status, "refused");
  assert.deepEqual(calls.map((c) => c[0]), ["bind"]);
});

test("an unusable bind answer fails closed", async () => {
  const { calls, effects } = recorder({ status: "error", reason: "adopt_worktree returned no usable capsule identity" });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: {}, effects });
  assert.equal(out.status, "refused");
  assert.equal(out.code, "bind_unusable");
  assert.deepEqual(calls.map((c) => c[0]), ["bind"]);
});

test("unreachable without break-glass: refuses and names the break-glass variable", async () => {
  const { calls, effects } = recorder({ status: "unavailable", reason: "DPF_MCP_BEARER_TOKEN is not set" });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: {}, effects });
  assert.equal(out.status, "unavailable");
  assert.match(out.message, new RegExp(BREAK_GLASS_ENV));
  assert.deepEqual(calls.map((c) => c[0]), ["bind"]);
});

test("unreachable with break-glass: creates and writes a PENDING marker, never a claim marker", async () => {
  const { calls, effects } = recorder({ status: "unavailable", reason: "fetch failed" });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: { [BREAK_GLASS_ENV]: "operator: portal down for upgrade" }, effects });
  assert.deepEqual(out, { status: "break-glass", path: plan.target, reason: "operator: portal down for upgrade" });
  assert.deepEqual(calls.map((c) => c[0]), ["bind", "add", "pending-marker"]);
  assert.equal(calls[2][2], "operator: portal down for upgrade");
});

test("a whitespace-only break-glass is not a reason", async () => {
  const { effects } = recorder({ status: "unavailable", reason: "fetch failed" });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: { [BREAK_GLASS_ENV]: "   " }, effects });
  assert.equal(out.status, "unavailable");
});

test("bound but git worktree add failed: reports failure with the bound room, no marker", async () => {
  const { calls, effects } = recorder({ status: "bound", capsuleId: "WC-1", marker }, { addThrows: true });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: {}, effects });
  assert.equal(out.status, "failed");
  assert.equal(out.capsuleId, "WC-1");
  assert.deepEqual(calls.map((c) => c[0]), ["bind", "add"]);
});

test("a failed identity re-bind after creation is a warning: the claim already exists", async () => {
  const { calls, effects } = recorder({ status: "bound", capsuleId: "WC-1", marker }, { afterResult: { status: "unavailable", reason: "observation failed" } });
  const out = await provisionWorktree({ mainRoot: "D:/DPF", plan, env: {}, effects });
  assert.equal(out.status, "created");
  assert.match(out.warning, /observation failed/);
  assert.deepEqual(calls.map((c) => c[0]), ["bind", "add", "after"]);
});

for (const [status, oauthError, expectedCode] of [
  [400, "invalid_client", "mcp_authentication_failed"],
  [400, "invalid_scope", "mcp_authorization_failed"],
  [401, "invalid_client", "mcp_authentication_failed"],
  [403, "access_denied", "mcp_authorization_failed"],
  [429, "temporarily_unavailable", "mcp_credential_exchange_refused"],
]) {
  test(`OAuth ${status}/${oauthError} cannot enter break-glass through the real bearer and binder`, async () => {
    const env = { DPF_MCP_ENDPOINT: "http://127.0.0.1:1/api/mcp/v1", DPF_MCP_CLIENT_ID: "fixture-client",
      DPF_MCP_CLIENT_SECRET: "fixture-secret", [BREAK_GLASS_ENV]: "fixture operator recovery" };
    let exchanges = 0, adoptionRequests = 0;
    const bearer = createClientCredentialsBearer({ mcpUrl: env.DPF_MCP_ENDPOINT, clientId: "fixture-client", clientSecret: "fixture-secret",
      exchange: options => exchangeClientCredentials({ ...options, post: async () => {
        exchanges++;
        return { status, body: JSON.stringify({ error: oauthError, error_description: "fixture-denial-detail" }) };
      } }),
    });
    const { effects, calls } = recorder(null);
    effects.bind = args => bindWorktreeToWorkroom({ ...args, env,
      call: (name, params, options) => mcpCall(name, params, { ...options, bearerToken: bearer,
        fetchImpl: async () => { adoptionRequests++; assert.fail("no MCP request after denied token exchange"); },
      }),
    });
    const result = await provisionWorktree({ mainRoot: "D:/fixture", plan, env, effects });
    assert.equal(result.status, "refused");
    assert.equal(result.code, expectedCode);
    assert.equal(exchanges, 1);
    assert.equal(adoptionRequests, 0);
    assert.equal(calls.length, 0, "no creation, marker, or source rebind");
    assert.ok(!result.message.includes("fixture-denial-detail"));
  });
}

test("a genuine OAuth service outage retains bounded break-glass recovery", async () => {
  const env = { DPF_MCP_ENDPOINT: "http://127.0.0.1:1/api/mcp/v1", DPF_MCP_CLIENT_ID: "fixture-client",
    DPF_MCP_CLIENT_SECRET: "fixture-secret", [BREAK_GLASS_ENV]: "fixture service outage" };
  const bearer = createClientCredentialsBearer({ mcpUrl: env.DPF_MCP_ENDPOINT, clientId: "fixture-client", clientSecret: "fixture-secret",
    exchange: options => exchangeClientCredentials({ ...options, post: async () => ({ status: 503, body: "service unavailable" }) }),
  });
  const { effects, calls } = recorder(null);
  effects.bind = args => bindWorktreeToWorkroom({ ...args, env,
    call: (name, params, options) => mcpCall(name, params, { ...options, bearerToken: bearer,
      fetchImpl: async () => assert.fail("no adoption request without a token"),
    }),
  });
  const result = await provisionWorktree({ mainRoot: "D:/fixture", plan, env, effects });
  assert.equal(result.status, "break-glass");
  assert.deepEqual(calls.map(call => call[0]), ["add", "pending-marker"]);
});
