import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { McpTaskRunRow, TaskLifecycleResult } from "./tasks-lifecycle";
import { projectOwnedTaskRead } from "./owned-task-read-projection";

const at = new Date("2026-10-21T14:37:00.000Z");
const task = (extra: Partial<McpTaskRunRow> = {}): McpTaskRunRow => ({
  taskRunId: "TR-MCP-OWNED", userId: "human", title: "PRIVATE TITLE", objective: "PRIVATE PROMPT",
  status: "completed", createdAt: at, updatedAt: at, completedAt: at,
  progressPayload: { summary: "The original task completed." }, ...extra,
});
const result = (structured: Record<string, unknown>, isError = false): TaskLifecycleResult => ({
  kind: "ok", value: { structuredContent: { taskId: "TR-MCP-OWNED", status: "completed", terminal: true, ...structured },
    content: [{ type: "text", text: "DO NOT COPY ARBITRARY CANONICAL CONTENT" }], isError },
});
const invoke = (row = task(), lifecycle = result({}), originKind: "external" | "native" | "initiative" | "durable" = "external", mode: "status" | "result" = "result") =>
  projectOwnedTaskRead({ task: row, lifecycle, originKind, mode });
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

describe("owned task read projection", () => {
  it("keeps the actual terminal summary after the canonical progress budget discarded it", () => {
    const output = invoke(task({ progressPayload: { summary: "Accepted handoff result", raw: "SECRET", prompt: "SECRET" } }),
      result({ progressPayload: { _truncated: true } }));
    expect(output).toMatchObject({ success: true, data: {
      schemaVersion: 1, projection: "owned-mcp-task.v1", mode: "result", taskId: "TR-MCP-OWNED",
      status: "completed", terminal: true, isError: false, readOnly: true, retryAuthorized: false,
      createdAt: at.toISOString(), lastUpdatedAt: at.toISOString(), completedAt: at.toISOString(),
      summary: { text: "Accepted handoff result", truncated: false, sha256: digest("Accepted handoff result"), originalChars: 23 },
    } });
    expect(JSON.stringify(output)).not.toMatch(/SECRET|PRIVATE|DO NOT COPY/);
  });

  it("uses the canonical status and does not expose result text in status mode", () => {
    const output = invoke(task({ status: "submitted", completedAt: null }), { kind: "ok", value: {
      taskId: "TR-MCP-OWNED", status: "working", createdAt: at.toISOString(), lastUpdatedAt: at.toISOString(),
    } }, "external", "status");
    expect(output).toMatchObject({ success: true, data: { status: "working", terminal: false, isError: false, completedAt: null } });
    expect(output.data).not.toHaveProperty("summary");
  });

  it.each([
    ["completed", null], ["completed", { unrelated: "SECRET" }], ["completed", { summary: "  " }],
    ["failed", { errorCode: "provider_error" }],
  ] as const)("refuses result mode for %s when no interpretable answer or error was recorded", (status, progressPayload) => {
    const output = invoke(task({ status, progressPayload }), result({ status }, status === "failed"));
    expect(output).toMatchObject({ success: false, error: "owned_task_read_incompatible" });
    expect(JSON.stringify(output)).not.toContain("SECRET");
  });

  it("allows status-only observation of terminal work whose result is unavailable", () => {
    expect(invoke(task({ progressPayload: null }), { kind: "ok", value: { taskId: "TR-MCP-OWNED", status: "completed" } },
      "external", "status")).toMatchObject({ success: true, data: { status: "completed", terminal: true } });
  });

  it.each([
    ["completed", "completed", false], ["failed", "failed", true],
    ["rejected", "failed", true], ["canceled", "cancelled", false], ["archived", "completed", false],
  ])("preserves the canonical %s disposition", (raw, status, isError) => {
    expect(invoke(task({ status: raw }), result({ status }, isError))).toMatchObject({
      success: true, data: { status, terminal: true, isError },
    });
  });

  it("retains uncertainty, wait and genuine approval facts while stripping private nested fields", () => {
    const row = task({ status: "input-required", completedAt: null, progressPayload: {
      summary: "Still unsettled", executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown",
        providerId: "anthropic-sub", rawOutput: "SECRET" },
    } });
    const output = invoke(row, result({ status: "input_required", terminal: false, waitReason: "execution-uncertain", resumable: false,
      requiresApproval: true, approval: { envelopeId: "ENV-1", delegatingUserId: "human", taskRunId: row.taskRunId,
        status: "proposed", expiresAt: null, approveHref: "/approve/ENV-1", declineHref: "/decline/ENV-1",
        inboxHref: "/workspace/inbox", nextAction: "Open the inbox", rawAuthority: "SECRET" } }));
    expect(output).toMatchObject({ success: true, data: { status: "input_required", terminal: false,
      waitReason: "execution-uncertain", resumable: false, requiresApproval: true, retryAuthorized: false,
      executionUncertainty: { kind: "execution-uncertain", settlement: "unknown" }, approval: { envelopeId: "ENV-1" } } });
    expect(JSON.stringify(output)).not.toContain("SECRET");
  });

  it.each([{ schemaVersion: 99, settlement: "settled" }, { kind: "new-unknown-outcome" }])("refuses uninterpretable uncertainty %j", marker => {
    expect(invoke(task({ progressPayload: { summary: "Looks complete", executionUncertainty: marker } }))).toMatchObject({
      success: false, error: "owned_task_read_incompatible",
    });
  });

  it("gets native receipt decisions only from the canonical admitted evidence", () => {
    const output = invoke(task({ progressPayload: { summary: "Native summary", receipt: { decision: "pass" } } }), result({
      evidence: { id: "EVIDENCE-1", state: "available", recordedAt: at.toISOString(), receipt: {
        schemaVersion: "semantic-change-review-receipt.v3", artifactType: "code", capsuleId: "WC-1",
        headTreeHash: "a".repeat(40), diffDigest: "b".repeat(64), result: { decision: "fail", summary: "A defect remains", issues: [{ description: "SECRET" }] },
        failureAnalysis: { prompt: "SECRET" }, authoritySnapshot: "SECRET",
      } },
    }), "native");
    expect(output).toMatchObject({ success: true, data: { evidence: { id: "EVIDENCE-1", receipt: {
      result: { decision: "fail", summary: { text: "A defect remains" } },
    } } } });
    expect(JSON.stringify(output)).not.toMatch(/SECRET|"decision":"pass"/);
  });

  it("refuses an unfamiliar native receipt decision", () => {
    expect(invoke(task(), result({ evidence: { id: "E1", state: "available", recordedAt: at.toISOString(), receipt: {
      schemaVersion: "semantic-change-review-receipt.v3", artifactType: "code", result: { decision: "maybe", summary: "Unknown" },
    } } }), "native")).toMatchObject({ success: false, error: "owned_task_read_incompatible" });
  });

  it("refuses a native receipt whose prior truncation erased the genuine decision", () => {
    expect(invoke(task(), result({ evidence: { id: "E1", state: "available", recordedAt: at.toISOString(),
      receiptTruncated: true, receiptSha256: "a".repeat(64) } }), "native")).toMatchObject({
      success: false, error: "owned_task_read_incompatible",
    });
  });

  it.each(["native", "durable"] as const)("refuses a terminal %s result lacking its mandatory result disposition", originKind => {
    expect(invoke(task(), result({}), originKind)).toMatchObject({ success: false, error: "owned_task_read_incompatible" });
  });

  it("refuses a role-bound native receipt missing its artifact type", () => {
    expect(invoke(task(), result({ evidence: { id: "E1", state: "available", recordedAt: at.toISOString(), receipt: {
      schemaVersion: "semantic-change-review-receipt.v3", result: { decision: "pass", summary: "Missing role proof" },
    } } }), "native")).toMatchObject({ success: false, error: "owned_task_read_incompatible" });
  });

  it("retains an explicit unavailable native receipt as an unavailable receipt", () => {
    expect(invoke(task(), result({ evidence: { id: "E1", state: "unavailable" } }), "native")).toMatchObject({
      success: true, data: { evidence: { id: "E1", state: "unavailable" }, retryAuthorized: false },
    });
  });

  it("preserves a genuine initiative writer receipt without making it replayable", () => {
    const originalResult = { schemaVersion: 1, taskRunId: "TR-MCP-OWNED", classification: "receipt-complete",
      readOnly: true, replayAllowed: false, bounded: true, reason: "A genuine failed receipt exists; closure remains unproved.",
      observations: [], missingProof: [], receipt: { receiptId: "R1", gate: "plan-review", decision: "fail", authority: "SECRET" },
      proofInventory: { schemaVersion: 1, status: "observed", scope: "task-linked-records-only", captureComplete: false,
        settlement: "unknown", missingEvidence: [{ code: "child-closure", owner: "supervisor" }] }, rawRequest: "SECRET" };
    const output = invoke(task({ status: "input-required", completedAt: null }), result({ status: "input_required", terminal: false,
      originalResult, resumable: false, requiresApproval: false }), "initiative");
    expect(output).toMatchObject({ success: true, data: { originalResult: { classification: "receipt-complete", replayAllowed: false,
      receipt: { decision: "fail" }, proofInventory: { settlement: "unknown", captureComplete: false } }, retryAuthorized: false } });
    expect(JSON.stringify(output)).not.toContain("SECRET");
  });

  it("preserves authenticated initiative uncertainty in status mode using a closed observation-fact allowlist", () => {
    const row = task({ status: "input-required", completedAt: null });
    const output = invoke(row, { kind: "ok", value: { taskId: row.taskRunId, status: "input_required", resumable: false,
      originalResult: { schemaVersion: 1, taskRunId: row.taskRunId, classification: "unknown", readOnly: true,
        replayAllowed: false, bounded: true, reason: "Child closure remains unverified", missingProof: ["child-closure"],
        observations: [{ source: "TaskRun.progressPayload.executionUncertainty", recordedAt: at.toISOString(), digest: "a".repeat(64),
          facts: { settlement: "unknown", childProcessClosure: "unverified", prompt: "SECRET" } }],
      } } }, "initiative", "status");
    expect(output).toMatchObject({ success: true, data: { status: "input_required", terminal: false,
      originalResult: { classification: "unknown", missingProof: ["child-closure"], observations: [{ facts: {
        settlement: "unknown", childProcessClosure: "unverified",
      } }] } } });
    expect(JSON.stringify(output)).not.toContain("SECRET");
  });

  it("preserves recovery settlement uncertainty and never turns resumability into retry authority", () => {
    expect(invoke(task({ status: "input-required", completedAt: null }), result({ status: "input_required", terminal: false,
      recovery: { classification: "execution-uncertain", budget: "expired", executing: false, pollUseful: false,
        nextAction: "Reconcile before recovery", requestDigest: "a".repeat(64), remainingAttempts: 0,
        details: { nodes: [{ taskNodeId: "N1", status: "failed", digestMatches: true, providerOutcome: "unknown", settlement: "unverified" }],
          truncated: false, unresolvedNodeIds: ["N1"], remediation: { state: "missing-current-proof", verificationId: null,
            executionSettled: false, retryAuthorized: false, nextAction: "Provide actual scoped evidence" } } }, resumable: true,
    }), "native")).toMatchObject({ success: true, data: { resumable: true, retryAuthorized: false,
      recovery: { classification: "execution-uncertain", details: { remediation: { executionSettled: false, retryAuthorized: false } } } } });
  });

  it("preserves durable error text and provenance without exposing raw operation metadata", () => {
    const output = invoke(task({ status: "failed" }), result({ status: "failed", resultText: null, errorMessage: "Provider failed",
      errorTruncated: false, errorSha256: digest("Provider failed"), errorOriginalChars: 15,
      provenance: { asyncOperationId: "OP-1", requestDigest: "a".repeat(64), contractFamily: "owned-read", providerId: "local",
        modelId: "model", providerOperationId: null, checkpointSequence: 3, transitionSequence: 4, rawRequest: "SECRET" } }, true), "durable");
    expect(output).toMatchObject({ success: true, data: { isError: true, errorMessage: { text: "Provider failed", originalChars: 15 },
      provenance: { asyncOperationId: "OP-1", checkpointSequence: 3 } } });
    expect(JSON.stringify(output)).not.toContain("SECRET");
  });

  it("keeps an upstream durable truncation identity rather than hashing only its shortened text", () => {
    const original = "x".repeat(120_000);
    expect(invoke(task(), result({ resultText: original.slice(0, 100), resultTruncated: true, resultSha256: digest(original),
      resultOriginalChars: original.length }), "durable")).toMatchObject({ success: true, data: {
      resultText: { text: original.slice(0, 100), truncated: true, sha256: digest(original), originalChars: original.length },
    } });
  });

  it("preserves the durable status owner's bounded progress facts", () => {
    expect(invoke(task({ status: "working", completedAt: null }), { kind: "ok", value: {
      taskId: "TR-MCP-OWNED", status: "working", asyncOperation: { asyncOperationId: "OP-1", status: "working",
        progressPct: 37.5, progressMessage: "Collecting output", checkpointSequence: 2, transitionSequence: 3,
        expiresAt: at.toISOString(), prompt: "SECRET" },
    } }, "durable", "status")).toMatchObject({ success: true, data: { asyncOperation: {
      progressPct: 37.5, progressMessage: { text: "Collecting output" }, expiresAt: at.toISOString(),
    } } });
  });

  it("uses the canonical durable operation update time when its TaskRun is still stale and working", () => {
    const operationUpdatedAt = "2026-10-21T14:48:00.000Z";
    expect(invoke(task({ status: "working", completedAt: null }), { kind: "ok", value: {
      taskId: "TR-MCP-OWNED", status: "completed", createdAt: at.toISOString(), lastUpdatedAt: operationUpdatedAt,
      asyncOperation: { asyncOperationId: "OP-1", status: "completed", checkpointSequence: 3, transitionSequence: 4,
        expiresAt: "2026-10-21T15:00:00.000Z" }, // clock-bomb-guard: allow pure projection fixture; no wall-clock comparison or future-time requirement
    } }, "durable", "status")).toMatchObject({ success: true, data: {
      status: "completed", terminal: true, lastUpdatedAt: operationUpdatedAt, completedAt: null,
      taskLastUpdatedAt: at.toISOString(), taskCompletedAt: null,
    } });
  });

  it("uses the canonical durable completion time without relabeling the old TaskRun update as an operation update", () => {
    const operationCompletedAt = "2026-10-21T14:48:00.000Z";
    expect(invoke(task({ status: "working", completedAt: null }), result({
      resultText: "The bound operation completed.", completedAt: operationCompletedAt,
    }), "durable")).toMatchObject({ success: true, data: {
      status: "completed", terminal: true, completedAt: operationCompletedAt, lastUpdatedAt: null,
      taskLastUpdatedAt: at.toISOString(), taskCompletedAt: null,
    } });
  });

  it("bounds the actual escaped ToolResult while retaining summary and error identity", () => {
    const summary = "\u0000\"\\\ud800".repeat(80_000);
    const error = "error\n\udfff".repeat(50_000);
    const output = invoke(task({ status: "failed", progressPayload: { summary, error, errorCode: "provider-outcome-uncertain" } }),
      result({ status: "failed" }, true));
    expect(output).toMatchObject({ success: true, data: { status: "failed", terminal: true, isError: true,
      summary: { truncated: true, sha256: digest(summary), originalChars: summary.length },
      error: { truncated: true, sha256: digest(error), originalChars: error.length } } });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(100_000);
    expect((output.data?.summary as { text: string }).text.length).toBeGreaterThan(0);
    expect((output.data?.error as { text: string }).text.length).toBeGreaterThan(0);
  });

  it("refuses an oversized mandatory identity instead of dropping outcome fields", () => {
    const output = invoke(task({ taskRunId: "X".repeat(100_000) }), result({ taskId: "X".repeat(100_000) }));
    expect(output.success).toBe(false);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(100_000);
    expect(output.data).toBeUndefined();
  });

  it("explicitly refuses when valid mandatory recovery facts exceed the entire envelope budget", () => {
    const nodeId = "N".repeat(512);
    const output = invoke(task({ status: "input-required", completedAt: null }), result({ status: "input_required", terminal: false,
      recovery: { classification: "execution-uncertain", nextAction: "Reconcile", details: {
        nodes: Array.from({ length: 100 }, () => ({ taskNodeId: nodeId, status: "S".repeat(512),
          digestMatches: false, providerOutcome: "unknown", settlement: "unverified" })),
        unresolvedNodeIds: Array.from({ length: 100 }, () => nodeId), truncated: false,
        remediation: { state: "missing-current-proof", executionSettled: false, retryAuthorized: false, nextAction: "Reconcile" },
      } },
    }), "native");
    expect(output).toMatchObject({ success: false, error: "owned_task_read_too_large" });
    expect(output.data).toBeUndefined();
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(100_000);
  });

  it("refuses malformed writer wait evidence rather than hiding its uncertain semantics", () => {
    expect(invoke(task({ progressPayload: { summary: "Finished", terminalWriterWait: { schemaVersion: 99, kind: "future-wait" } } })))
      .toMatchObject({ success: false, error: "owned_task_read_incompatible" });
  });

  it("refuses internally inconsistent upstream durable text identity", () => {
    expect(invoke(task(), result({ resultText: "actual", resultTruncated: false, resultSha256: digest("different"),
      resultOriginalChars: 6 }), "durable")).toMatchObject({ success: false, error: "owned_task_read_incompatible" });
  });

  it.each([
    { kind: "forbidden", message: "SECRET FOREIGN TASK" },
    { kind: "ok", value: { structuredContent: { taskId: "FOREIGN", status: "completed", terminal: true }, isError: false } },
    { kind: "ok", value: { structuredContent: { taskId: "TR-MCP-OWNED", status: "new-state", terminal: false }, isError: false } },
    { kind: "ok", value: { structuredContent: { taskId: "TR-MCP-OWNED", status: "working", terminal: true }, isError: false } },
  ] satisfies TaskLifecycleResult[])("refuses incompatible canonical output without leaking its body", lifecycle => {
    const output = invoke(task(), lifecycle);
    expect(output).toMatchObject({ success: false, error: "owned_task_read_incompatible" });
    expect(JSON.stringify(output)).not.toMatch(/SECRET|FOREIGN|PRIVATE/);
  });
});
