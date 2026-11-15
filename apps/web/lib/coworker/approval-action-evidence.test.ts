import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { readApprovalActionEvidence } from "./approval-action-evidence";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

const now = new Date("2026-10-21T00:00:00Z");
const createdAt = new Date("2026-10-16T00:00:00Z");
const parameters = { operation: "test", providerId: "chatgpt", connectionId: "provider-default-chatgpt" };
const fingerprint = fingerprintCoworkerInput(parameters);
function fixture() {
  const envelope = { id: "e1", status: "executed", delegatingUserId: "u1", coworkerAgentId: "a1", threadId: "t1",
    manifestActionId: "manage_provider_account", inputFingerprint: fingerprint, createdAt,
    argsJson: { approvalBinding: { actingHumanUserId: "u1", actingAgentId: "a1", toolName: "manage_provider_account",
      taskRunId: null, chainId: null, routeContext: null, inputFingerprint: fingerprint } } };
  const run = { id: "run1", envelopeId: "e1", userId: "u1", agentId: "a1", threadId: "t1", taskRunId: null,
    toolName: "manage_provider_account", executionMode: "external-jsonrpc", createdAt, durationMs: 1,
    parameters: { ...parameters }, success: true, result: { success: true, message: "Bearer SECRET", data: { secret: "SECRET" } } };
  const findMany = vi.fn(async () => [run]);
  const db = { toolExecution: { findMany } };
  return { envelope, run, db, findMany, read: () => readApprovalActionEvidence(envelope, db as never, now) };
}
describe("bounded original approval action evidence", () => {
  function diagnosticFixture() {
    const f = fixture(); const input = { command: "docker compose exec -T portal cat /dpf-state/service-converge-outcome.json" };
    const report = { mode: "shadow", targetSha: "a".repeat(40), at: "2026-10-15T00:00:00.000Z", outcome: "current",
      wouldRecreate: [], unchanged: ["postgres"], skippedStopped: [], dataOwnerChanged: [], unclassified: [], failed: [], bindDrift: [] };
    f.envelope.manifestActionId = "admin_run_command"; f.envelope.argsJson.approvalBinding.toolName = "admin_run_command";
    f.envelope.inputFingerprint = fingerprintCoworkerInput(input); f.envelope.argsJson.approvalBinding.inputFingerprint = f.envelope.inputFingerprint;
    Object.assign(f.run, { toolName: "admin_run_command", parameters: input,
      result: { success: true, data: { command: input.command, output: JSON.stringify(report), exitCode: 0 } } });
    return { ...f, input, readReport: () => readApprovalActionEvidence(f.envelope, f.db as never, now, undefined, true) };
  }
  it("projects only the exact already-executed report, never its command or raw output", async () => {
    const f = diagnosticFixture(); const result = await f.readReport();
    expect(result).toMatchObject({ state: "available", toolName: "admin_run_command", operation: "service-convergence-shadow",
      executionId: "run1", threadBinding: "matched", report: { mode: "shadow", classifications: { unchanged: ["postgres"] } } });
    expect(JSON.stringify(result)).not.toMatch(/docker compose|output|exitCode|parameters/);
  });
  it.each(["command", "output", "exit", "failed", "foreign", "ambiguous"])("keeps %s diagnostic evidence unproven or unsupported", async change => {
    const f = diagnosticFixture();
    if (change === "command") Object.assign(f.run.result.data, { command: "docker compose ps" });
    if (change === "output") Object.assign(f.run.result.data, { output: "SECRET" });
    if (change === "exit") Object.assign(f.run.result.data, { exitCode: 1 });
    if (change === "failed") Object.assign(f.run, { success: false, result: { success: false, data: { command: f.input.command, output: "SECRET", exitCode: 1 } } });
    if (change === "foreign") f.run.userId = "other";
    if (change === "ambiguous") f.findMany.mockResolvedValue([f.run, { ...f.run, id: "duplicate" }]);
    expect(await f.readReport()).not.toHaveProperty("report");
    expect(JSON.stringify(await f.readReport())).not.toContain("SECRET");
  });
  it("reads only persisted operation fields and never exposes messages or raw parameters", async () => {
    const f = fixture(); const result = await f.read();
    expect(result).toEqual({ state: "available", executionId: "run1", executedAtIso: createdAt.toISOString(),
      toolName: "manage_provider_account", operation: "test", connectionId: "provider-default-chatgpt", providerId: "chatgpt",
      outcome: "succeeded", threadBinding: "matched", responsesVerification: "unproven", quotaReconciliation: "unproven" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(f.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { envelopeId: "e1", toolName: "manage_provider_account" }, take: 11 }));
    expect(Object.keys(f.db)).toEqual(["toolExecution"]);
  });
  it("retains failed execution truth without returning private failure text", async () => {
    const f = fixture(); f.run.success = false; f.run.result.success = false;
    expect(await f.read()).toMatchObject({ state: "available", outcome: "failed" });
  });
  it("reports absent historical direct-call thread attribution without inventing a match", async () => {
    const f = fixture(); f.run.threadId = "";
    expect(await f.read()).toMatchObject({ state: "available", threadBinding: "not-recorded" });
  });
  it("does not apply the direct-call attribution exception to a different execution source", async () => {
    const f = fixture(); f.run.threadId = ""; f.run.executionMode = "agentic-loop";
    expect(await f.read()).toMatchObject({ state: "conflicting" });
  });
  it.each(["approved", "proposed", "expired", "declined"])("does not query operation records for %s approval", async status => {
    const f = fixture(); f.envelope.status = status;
    expect(await f.read()).toMatchObject({ state: "missing", reason: "not-settled" });
    expect(f.findMany).not.toHaveBeenCalled();
  });
  it("does not select payloads for unrelated operations", async () => {
    const f = fixture(); f.envelope.manifestActionId = "admin_run_command";
    expect(await f.read()).toMatchObject({ state: "unsupported" }); expect(f.findMany).not.toHaveBeenCalled();
  });
  it.each(["actingHumanUserId", "actingAgentId", "toolName", "inputFingerprint", "taskRunId", "chainId", "routeContext"])("refuses a changed stored binding %s before querying", async key => {
    const f = fixture(); Object.assign(f.envelope.argsJson.approvalBinding, { [key]: "different" });
    expect(await f.read()).toMatchObject({ state: "missing", reason: "binding-unproven" }); expect(f.findMany).not.toHaveBeenCalled();
  });
  it("refuses legacy absence of an approved input digest", async () => {
    const f = fixture(); f.envelope.inputFingerprint = "";
    expect(await f.read()).toMatchObject({ state: "missing", reason: "binding-unproven" });
  });
  it.each(["envelopeId", "toolName", "userId", "agentId", "threadId", "taskRunId"])("rejects mismatched original execution %s", async key => {
    const f = fixture(); Object.assign(f.run, { [key]: "different" });
    expect(await f.read()).toMatchObject({ state: "conflicting", reason: "execution-binding-mismatch" });
  });
  it("rejects changed account input even with a matching envelope and actor", async () => {
    const f = fixture(); f.run.parameters.connectionId = "another-account";
    expect(await f.read()).toMatchObject({ state: "conflicting" });
  });
  it("ignores server audit annotations when proving the original input", async () => {
    const f = fixture(); Object.assign(f.run.parameters, { _takAlignment: { private: "SECRET" } });
    expect(await f.read()).toMatchObject({ state: "available" });
  });
  it("does not take the newest result when actual executions conflict", async () => {
    const f = fixture(); f.findMany.mockResolvedValue([f.run, { ...f.run, id: "run2" }]);
    expect(await f.read()).toMatchObject({ state: "conflicting", reason: "execution-ambiguous" });
  });
  it("refuses query overflow even when the visible rows agree", async () => {
    const f = fixture(); f.findMany.mockResolvedValue(Array.from({ length: 11 }, () => f.run));
    expect(await f.read()).toMatchObject({ state: "conflicting", reason: "execution-ambiguous" });
  });
  it("does not confuse the parked request or status audit with the actual execution", async () => {
    const f = fixture(); const park = { ...f.run, success: false, result: { ...f.run.result, error: "approval_required" } };
    const status = { ...f.run, executionMode: "approval-outcome" };
    f.findMany.mockResolvedValue([park, status, f.run]);
    expect(await f.read()).toMatchObject({ state: "available", executionId: "run1" });
    f.findMany.mockResolvedValue([park, status]);
    expect(await f.read()).toMatchObject({ state: "missing", reason: "execution-missing" });
  });
  it("requires evidence that the operation ran rather than a pre-dispatch refusal", async () => {
    const f = fixture(); Object.assign(f.run, { durationMs: null });
    expect(await f.read()).toMatchObject({ state: "missing", reason: "execution-missing" });
  });
  it.each([new Date("invalid"), new Date("2026-01-01"), new Date("2027-01-01")])("refuses impossible execution time %s", async date => {
    const f = fixture(); f.run.createdAt = date;
    expect(await f.read()).toMatchObject({ state: "conflicting" });
  });
  it.each([{}, { success: "true" }, { success: false }, { success: true, error: "private" }])("does not infer success from malformed or contradictory payload %j", async result => {
    const f = fixture(); Object.assign(f.run, { result });
    expect(await f.read()).toMatchObject({ state: "missing", reason: "result-unproven" });
  });
  it.each(["configure", "sign-in", "enable"])("does not project another provider operation %s", async operation => {
    const f = fixture(); f.run.parameters.operation = operation;
    const digest = fingerprintCoworkerInput(f.run.parameters);
    f.envelope.inputFingerprint = digest; f.envelope.argsJson.approvalBinding.inputFingerprint = digest;
    expect(await f.read()).toMatchObject({ state: "unsupported" });
  });
});

it("preserves unsupported-operation classification even when its result is malformed", async () => {
  const f = fixture();
  f.run.parameters.operation = "activate";
  const changed = fingerprintCoworkerInput(f.run.parameters);
  f.envelope.inputFingerprint = changed;
  f.envelope.argsJson.approvalBinding.inputFingerprint = changed;
  f.run.result.success = false;
  expect(await f.read()).toEqual({ state: "unsupported", reason: "operation-unsupported" });
});

function runtimeFixture() {
  const f = fixture();
  const parameters = { transitionId: "RCT-original-fixture", imageServices: ["browser-use"], reconciliation: {
    observedHost: { schemaVersion: 1, installerVersion: "fixture", platform: "darwin", arch: "arm64",
      capabilityCatalogHash: "a".repeat(64), capabilityStateVersion: "b".repeat(64), enabledRuntimeCapabilities: [] },
    observedDatabaseStates: {}, desiredHostEnabledKeys: [], desiredDatabaseStates: {}, touchedKeys: [],
  } };
  Object.assign(f.envelope, { manifestActionId: "reconcile_runtime_capabilities" });
  Object.assign(f.run, { toolName: "reconcile_runtime_capabilities", parameters, success: false,
    result: { success: false, error: "runtime_transition_database_stale", message: "SECRET private handler message" } });
  const digest = fingerprintCoworkerInput(parameters);
  f.envelope.inputFingerprint = digest;
  Object.assign(f.envelope.argsJson.approvalBinding, { toolName: "reconcile_runtime_capabilities", inputFingerprint: digest });
  return f;
}

describe("the original runtime reconciliation result (BI-08B1B79B)", () => {
  it("shows the bound recorded refusal without replaying it or exposing private payload", async () => {
    const f = runtimeFixture();
    const result = await f.read();
    expect(result).toMatchObject({ state: "available", toolName: "reconcile_runtime_capabilities",
      operation: "reconciliation", transitionId: "RCT-original-fixture", outcome: "failed",
      failureCode: "runtime_transition_database_stale" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(f.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { envelopeId: "e1", toolName: "reconcile_runtime_capabilities" }, take: 11,
    }));
    expect(Object.keys(f.db)).toEqual(["toolExecution"]);
  });
  it("keeps an incomplete host observation distinct from a failed approval", async () => {
    const f = runtimeFixture();
    Object.assign(f.run, { result: { success: false, data: { status: "host_applied_pending_verification" } } });
    expect(await f.read()).toMatchObject({ state: "available", outcome: "incomplete",
      operationStatus: "host_applied_pending_verification" });
  });
  it("does not expose an arbitrary handler error as a verified cause", async () => {
    const f = runtimeFixture();
    Object.assign(f.run, { result: { success: false, error: "SECRET private runtime detail" } });
    const result = await f.read();
    expect(result).toMatchObject({ state: "available", outcome: "failed", failureCode: null });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("refuses contradictory successful audit and failed operation result", async () => {
    const f = runtimeFixture();
    Object.assign(f.run, { success: true, result: { success: true, data: { status: "failed" } } });
    expect(await f.read()).toEqual({ state: "missing", reason: "result-unproven" });
  });
  it.each(["userId", "agentId", "threadId", "envelopeId", "toolName"])("rejects a foreign runtime execution %s", async key => {
    const f = runtimeFixture(); Object.assign(f.run, { [key]: "foreign" });
    expect(await f.read()).toMatchObject({ state: "conflicting", reason: "execution-binding-mismatch" });
  });
  it("rejects oversized saved runtime payloads without projecting their contents", async () => {
    const f = runtimeFixture();
    Object.assign(f.run, { result: { success: false, error: "runtime_transition_database_stale", message: "x".repeat(MCP_ROUTE_TOOL_RESULT_CHAR_CAP + 1) } });
    expect(await f.read()).toEqual({ state: "missing", reason: "result-unproven" });
  });
  it("keeps ambiguous runtime executions unproven rather than choosing a newer result", async () => {
    const f = runtimeFixture(); f.findMany.mockResolvedValue([f.run, { ...f.run, id: "second-runtime-execution" }]);
    expect(await f.read()).toMatchObject({ state: "conflicting", reason: "execution-ambiguous" });
  });
});
