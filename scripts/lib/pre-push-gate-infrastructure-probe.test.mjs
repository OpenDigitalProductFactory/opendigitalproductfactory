// Contract for the `gate-infrastructure-unavailable` pre-push override probe
// (BI-02E5F2A1, DI-FC5699629694). Every side effect is injected: no host, no
// portal, no credential file is touched.
import assert from "node:assert/strict";
import test from "node:test";

import {
  GATE_INFRASTRUCTURE_UNAVAILABLE_CODE,
  LOCAL_CI_OVERRIDE_REASON_CODES,
  classifyGateInfrastructureEvidence,
  classifyLocalCiOverride,
} from "../../packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs";
import {
  PROBE_RELEASE_TOOL,
  PROBE_TOOL,
  classifyLeaseProbeOutcome,
  probeGateInfrastructure,
} from "./pre-push-gate-infrastructure-probe.mjs";

const MCP_URL = "http://127.0.0.1:3000/api/mcp/v1";
const PAT_ENV = { DPF_MCP_BEARER_TOKEN: "pat-placeholder-not-a-real-token" };

function baseProbeInput(overrides = {}) {
  return {
    mcpUrl: MCP_URL,
    branch: "fix/x",
    sha: "a".repeat(40),
    worktreePath: "/wt/x",
    portalUrl: "http://localhost:3001",
    ports: [3001, 5433],
    env: PAT_ENV,
    now: (() => { let t = 1_000; return () => (t += 5); })(),
    ...overrides,
  };
}

test("the code is allowlisted and classifies like every other code", () => {
  assert.ok(LOCAL_CI_OVERRIDE_REASON_CODES.includes(GATE_INFRASTRUCTURE_UNAVAILABLE_CODE));
  assert.deepEqual(classifyLocalCiOverride("gate-infrastructure-unavailable: token dead"), {
    ok: true,
    code: GATE_INFRASTRUCTURE_UNAVAILABLE_CODE,
    detail: "token dead",
  });
});

test("classify: HTTP 401 JSON-RPC error envelope is credential-rejected evidence", () => {
  const outcome = classifyLeaseProbeOutcome({
    response: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "unauthorized: invalid or expired token" } },
  });
  assert.equal(outcome.infrastructureUnavailable, true);
  assert.equal(outcome.kind, "credential-rejected");
  assert.equal(outcome.statusCode, 401);
  assert.match(outcome.message, /invalid or expired token/);
});

test("classify: connection refused / timeout are transport-unreachable evidence", () => {
  for (const text of ["connect ECONNREFUSED 127.0.0.1:3000", `mcpCall: ${PROBE_TOOL} timed out after 15000ms`, "fetch failed"]) {
    const outcome = classifyLeaseProbeOutcome({ error: new Error(text) });
    assert.equal(outcome.infrastructureUnavailable, true, text);
    assert.equal(outcome.kind, "transport-unreachable", text);
  }
});

test("classify: a non-JSON 5xx body is server-error evidence", () => {
  const outcome = classifyLeaseProbeOutcome({
    error: new Error(`mcpCall: invalid JSON response from ${MCP_URL} (status 502): Unexpected token <`),
  });
  assert.equal(outcome.infrastructureUnavailable, true);
  assert.equal(outcome.kind, "server-error");
});

test("classify: a successful claim is NOT evidence — the gate can run", () => {
  const outcome = classifyLeaseProbeOutcome({
    response: { success: true, data: { admission: { status: "admitted" }, lease: { leaseId: "NPEL-1" } } },
  });
  assert.equal(outcome.infrastructureUnavailable, false);
  assert.equal(outcome.outcome, "claim-succeeded");
  assert.equal(outcome.leaseId, "NPEL-1");
});

test("classify: a healthy server refusing the claim for a non-auth reason is NOT evidence", () => {
  const outcome = classifyLeaseProbeOutcome({ response: { success: false, error: "missing_required" } });
  assert.equal(outcome.infrastructureUnavailable, false);
  assert.equal(outcome.outcome, "claim-refused");
});

test("classify: insufficient_token_scope is a credential failure the gate cannot get past", () => {
  const outcome = classifyLeaseProbeOutcome({ response: { success: false, error: "insufficient_token_scope" } });
  assert.equal(outcome.infrastructureUnavailable, true);
  assert.equal(outcome.kind, "credential-rejected");
});

test("probe: a failed claim yields evidence naming the tool, the failure and never the token", async () => {
  const calls = [];
  const call = async (tool, args) => {
    calls.push({ tool, args });
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "unauthorized: invalid or expired token" } };
  };
  const result = await probeGateInfrastructure(baseProbeInput({ call }));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tool, PROBE_TOOL);
  assert.equal(calls[0].args.environmentKey, "local-integration-ci");
  assert.equal(calls[0].args.branchName, "fix/x");
  assert.equal(result.evidence.code, GATE_INFRASTRUCTURE_UNAVAILABLE_CODE);
  assert.equal(result.evidence.tool, PROBE_TOOL);
  assert.equal(result.evidence.kind, "credential-rejected");
  assert.equal(result.evidence.credentialKind, "pat");
  assert.equal(typeof result.evidence.probedAt, "string");
  assert.equal(typeof result.evidence.durationMs, "number");
  assert.doesNotMatch(JSON.stringify(result), /pat-placeholder-not-a-real-token/, "the credential must never be in the evidence");
  // The record the hook writes must satisfy every reader's evidence check.
  assert.equal(classifyGateInfrastructureEvidence(result.evidence).ok, true);
});

test("probe: a thrown transport error yields transport-unreachable evidence", async () => {
  const call = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:3000"); };
  const result = await probeGateInfrastructure(baseProbeInput({ call }));
  assert.equal(result.ok, true);
  assert.equal(result.evidence.kind, "transport-unreachable");
});

test("probe: a successful claim is released and the override is REFUSED", async () => {
  const calls = [];
  const call = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === PROBE_TOOL) {
      return { success: true, data: { admission: { status: "admitted" }, lease: { leaseId: "NPEL-PROBE" } } };
    }
    return { success: true };
  };
  const result = await probeGateInfrastructure(baseProbeInput({ call }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "claim-succeeded");
  assert.match(result.refusal, /pnpm run pregate/);
  assert.equal(calls[1].tool, PROBE_RELEASE_TOOL);
  assert.equal(calls[1].args.leaseId, "NPEL-PROBE");
  assert.equal(result.details.released, "released");
});

test("probe: a queued claim still means the pool answers — refused, nothing left behind silently", async () => {
  const calls = [];
  const call = async (tool) => {
    calls.push(tool);
    if (tool === PROBE_TOOL) {
      return { success: true, data: { admission: { status: "queued" }, lease: { leaseId: "NPEL-Q" } } };
    }
    return { success: false, error: "nonprod_lease_not_owner" };
  };
  const result = await probeGateInfrastructure(baseProbeInput({ call }));
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [PROBE_TOOL, PROBE_RELEASE_TOOL]);
  assert.match(result.details.released, /release failed/);
  assert.match(result.refusal, /release failed/, "an unreleased probe lease is surfaced, not hidden");
});

test("probe: no configured credential is not infrastructure evidence", async () => {
  let called = false;
  const call = async () => { called = true; };
  const result = await probeGateInfrastructure(baseProbeInput({ call, env: {} }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "no-credential");
  assert.equal(called, false);
});

test("evidence classifier: prose without a captured response is rejected", () => {
  assert.equal(classifyGateInfrastructureEvidence(undefined).ok, false);
  assert.equal(classifyGateInfrastructureEvidence({ kind: "credential-rejected", message: "x" }).ok, false, "must name the tool");
  assert.equal(classifyGateInfrastructureEvidence({ tool: PROBE_TOOL, kind: "vibes", message: "x" }).ok, false);
  assert.equal(classifyGateInfrastructureEvidence({ tool: PROBE_TOOL, kind: "server-error", message: "status 502" }).ok, true);
});
