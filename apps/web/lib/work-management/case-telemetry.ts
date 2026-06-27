import type { ReceiptEnvelope } from "./receipt-envelope";

export type WorkCaseTelemetryAttributeValue = string | number | boolean;

export interface WorkCaseTelemetryEvent {
  name: "work_case.action";
  occurredAt: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  attributes: Record<string, WorkCaseTelemetryAttributeValue>;
}

function setIfDefined(
  attributes: Record<string, WorkCaseTelemetryAttributeValue>,
  key: string,
  value: string | undefined,
) {
  if (value) attributes[key] = value;
}

export function projectReceiptEnvelopeEvent(
  receipt: ReceiptEnvelope,
): WorkCaseTelemetryEvent {
  const attributes: Record<string, WorkCaseTelemetryAttributeValue> = {
    "work_case.id": receipt.caseRef?.caseId ?? receipt.sourceRef.id,
    "work_case.action": receipt.actionType ?? "unknown",
    "work_case.enforcement_mode": receipt.enforcementMode,
    "work_case.receipt.id": receipt.receiptId,
    "work_case.receipt.kind": receipt.receiptKind,
    "work_case.receipt.status": receipt.status,
    "work_case.source.kind": receipt.sourceRef.kind,
    "work_case.source.id": receipt.sourceRef.id,
    "work_case.raw.table": receipt.rawRef.table,
    "work_case.raw.id": receipt.rawRef.id,
  };

  setIfDefined(attributes, "work_case.source_type", receipt.caseRef?.sourceType);
  setIfDefined(attributes, "work_case.source.ref_type", receipt.sourceRef.sourceType);

  return {
    name: "work_case.action",
    occurredAt: receipt.occurredAt,
    traceId: receipt.trace?.traceId,
    spanId: receipt.trace?.spanId,
    parentSpanId: receipt.trace?.parentSpanId,
    attributes,
  };
}
