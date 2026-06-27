import { describe, expect, it } from "vitest";

import type { ReceiptEnvelope } from "./receipt-envelope";
import { projectReceiptEnvelopeEvent } from "./case-telemetry";

const RECEIPT = {
  receiptId: "ter-1",
  caseRef: {
    caseId: "backlog-item:BI-1",
    sourceType: "backlog-item",
    sourceId: "BI-1",
  },
  receiptKind: "work-case-governed-action",
  enforcementMode: "governed-action",
  sourceRef: {
    kind: "source",
    id: "te-1",
    sourceType: "tool-execution",
  },
  actionType: "complete",
  status: "valid",
  summary: "work-case-governed-action valid for te-1",
  occurredAt: "2026-06-27T21:00:00.000Z",
  outputDigest: { ok: true },
  policyRefs: ["golden-triangle:assured"],
  trace: {
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: "parent-1",
  },
  rawRef: {
    table: "ToolExecutionReceipt",
    id: "ter-1",
  },
} as const satisfies ReceiptEnvelope;

describe("projectReceiptEnvelopeEvent", () => {
  it("projects a ReceiptEnvelope to a stable OTel-compatible event", () => {
    expect(projectReceiptEnvelopeEvent(RECEIPT)).toEqual({
      name: "work_case.action",
      occurredAt: "2026-06-27T21:00:00.000Z",
      traceId: "trace-1",
      spanId: "span-1",
      parentSpanId: "parent-1",
      attributes: {
        "work_case.id": "backlog-item:BI-1",
        "work_case.source_type": "backlog-item",
        "work_case.action": "complete",
        "work_case.enforcement_mode": "governed-action",
        "work_case.receipt.id": "ter-1",
        "work_case.receipt.kind": "work-case-governed-action",
        "work_case.receipt.status": "valid",
        "work_case.source.kind": "source",
        "work_case.source.id": "te-1",
        "work_case.source.ref_type": "tool-execution",
        "work_case.raw.table": "ToolExecutionReceipt",
        "work_case.raw.id": "ter-1",
      },
    });
  });
});
