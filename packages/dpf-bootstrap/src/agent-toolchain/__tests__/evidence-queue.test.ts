import { describe, expect, it } from "vitest";

import {
  createLocalEvidenceEnvelope,
  parseEvidenceQueue,
  planEvidenceQueueWrite,
  reconcileEvidenceQueue,
} from "../evidence-queue";

describe("local evidence queue", () => {
  it("creates a stable, bearer-free envelope for MCP evidence writes while offline", () => {
    const envelope = createLocalEvidenceEnvelope({
      createdAt: "2026-06-27T16:30:00.000Z",
      idempotencyKey: "BI-E29B44F9:test-pass",
      target: { itemId: "BI-E29B44F9" },
      toolName: "record_execution_evidence",
      payload: {
        itemId: "BI-E29B44F9",
        kind: "test_pass",
        summary: "Targeted bootstrap preflight tests passed",
        body: "Portal was unavailable; evidence queued locally.",
      },
    });

    expect(envelope.envelopeId).toBe("evq_21727aa4e3384716");
    expect(envelope.status).toBe("queued");
    expect(JSON.stringify(envelope)).not.toMatch(/dpfmcp_|Bearer\s+\w/);
  });

  it("plans an idempotent queue write and replaces an existing envelope by id", () => {
    const first = createLocalEvidenceEnvelope({
      createdAt: "2026-06-27T16:30:00.000Z",
      idempotencyKey: "same",
      target: { itemId: "BI-E29B44F9" },
      toolName: "record_execution_evidence",
      payload: { itemId: "BI-E29B44F9", kind: "manual_check", summary: "first" },
    });
    const second = createLocalEvidenceEnvelope({
      createdAt: "2026-06-27T16:31:00.000Z",
      idempotencyKey: "same",
      target: { itemId: "BI-E29B44F9" },
      toolName: "record_execution_evidence",
      payload: { itemId: "BI-E29B44F9", kind: "manual_check", summary: "second" },
    });

    const write = planEvidenceQueueWrite("queue.json", JSON.stringify([first]), second);

    expect(write.path).toBe("queue.json");
    const parsed = parseEvidenceQueue(write.content);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].payload.summary).toBe("second");
  });

  it("reconciles sent envelopes and preserves conflicts for operator review", async () => {
    const sent = createLocalEvidenceEnvelope({
      createdAt: "2026-06-27T16:30:00.000Z",
      idempotencyKey: "sent",
      target: { itemId: "BI-E29B44F9" },
      toolName: "record_execution_evidence",
      payload: { itemId: "BI-E29B44F9", kind: "test_pass", summary: "sent" },
    });
    const conflict = createLocalEvidenceEnvelope({
      createdAt: "2026-06-27T16:30:00.000Z",
      idempotencyKey: "conflict",
      target: { itemId: "BI-E29B44F9" },
      toolName: "record_execution_evidence",
      payload: { itemId: "BI-E29B44F9", kind: "manual_check", summary: "conflict" },
    });

    const result = await reconcileEvidenceQueue({
      envelopes: [sent, conflict],
      attemptedAt: "2026-06-27T16:40:00.000Z",
      send: async (envelope) =>
        envelope.payload.summary === "conflict"
          ? { ok: false, conflict: true, error: "remote item is done" }
          : { ok: true, remoteId: "activity-1" },
    });

    expect(result.sent).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.updatedEnvelopes[0]).toMatchObject({
      status: "sent",
      remoteId: "activity-1",
      lastAttemptAt: "2026-06-27T16:40:00.000Z",
    });
    expect(result.updatedEnvelopes[1]).toMatchObject({
      status: "conflict",
      lastError: "remote item is done",
    });
  });
});
