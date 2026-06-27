/**
 * Local evidence queue for agent preflight / bootstrap work.
 *
 * MCP is the coordination plane, but the preflight itself must keep working
 * when the portal or MCP endpoint is down. This module defines the small local
 * envelope we can persist while offline and reconcile once MCP returns.
 *
 * Pure planning + reconciliation only. Shell adapters own filesystem writes
 * and the actual MCP client call.
 */

import { createHash } from "node:crypto";

export type EvidenceToolName =
  | "record_execution_evidence"
  | "record_external_development_evidence"
  | "record_capsule_evidence";

export type EvidencePayload = Record<string, unknown> & {
  itemId?: string;
  kind?: string;
  summary: string;
  body?: string;
  url?: string;
};

export type LocalEvidenceEnvelope = {
  schemaVersion: 1;
  envelopeId: string;
  idempotencyKey: string;
  createdAt: string;
  target: {
    itemId?: string;
    capsuleId?: string;
    buildId?: string;
  };
  toolName: EvidenceToolName;
  payload: EvidencePayload;
  status: "queued" | "sent" | "conflict";
  lastAttemptAt?: string;
  remoteId?: string;
  lastError?: string;
};

export type EvidenceQueueWritePlan = {
  path: string;
  content: string;
};

export type EvidenceQueueSendResult =
  | { ok: true; remoteId?: string }
  | { ok: false; error: string; conflict?: boolean };

export type EvidenceQueueReconcileResult = {
  updatedEnvelopes: LocalEvidenceEnvelope[];
  sent: number;
  conflicts: number;
  pending: number;
};

export function createLocalEvidenceEnvelope(args: {
  idempotencyKey: string;
  createdAt: string;
  target: LocalEvidenceEnvelope["target"];
  toolName: EvidenceToolName;
  payload: EvidencePayload;
}): LocalEvidenceEnvelope {
  return {
    schemaVersion: 1,
    envelopeId: `evq_${stableHash(args.idempotencyKey)}`,
    idempotencyKey: args.idempotencyKey,
    createdAt: args.createdAt,
    target: args.target,
    toolName: args.toolName,
    payload: args.payload,
    status: "queued",
  };
}

export function parseEvidenceQueue(text: string | null | undefined): LocalEvidenceEnvelope[] {
  if (!text || text.trim() === "") return [];
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Evidence queue must be a JSON array.");
  }
  return parsed.map((entry) => normalizeEnvelope(entry));
}

export function planEvidenceQueueWrite(
  path: string,
  existingText: string | null | undefined,
  envelope: LocalEvidenceEnvelope,
): EvidenceQueueWritePlan {
  const existing = parseEvidenceQueue(existingText);
  const index = existing.findIndex((entry) => entry.envelopeId === envelope.envelopeId);
  if (index >= 0) {
    existing[index] = envelope;
  } else {
    existing.push(envelope);
  }
  return {
    path,
    content: `${JSON.stringify(existing, null, 2)}\n`,
  };
}

export async function reconcileEvidenceQueue(args: {
  envelopes: LocalEvidenceEnvelope[];
  attemptedAt: string;
  send: (envelope: LocalEvidenceEnvelope) => Promise<EvidenceQueueSendResult>;
}): Promise<EvidenceQueueReconcileResult> {
  const updated: LocalEvidenceEnvelope[] = [];
  let sent = 0;
  let conflicts = 0;
  let pending = 0;

  for (const envelope of args.envelopes) {
    if (envelope.status === "sent") {
      updated.push(envelope);
      sent += 1;
      continue;
    }
    if (envelope.status === "conflict") {
      updated.push(envelope);
      conflicts += 1;
      continue;
    }

    const result = await args.send(envelope);
    if (result.ok) {
      sent += 1;
      updated.push({
        ...envelope,
        status: "sent",
        lastAttemptAt: args.attemptedAt,
        remoteId: result.remoteId,
        lastError: undefined,
      });
      continue;
    }

    if (result.conflict) {
      conflicts += 1;
      updated.push({
        ...envelope,
        status: "conflict",
        lastAttemptAt: args.attemptedAt,
        lastError: result.error,
      });
      continue;
    }

    pending += 1;
    updated.push({
      ...envelope,
      status: "queued",
      lastAttemptAt: args.attemptedAt,
      lastError: result.error,
    });
  }

  return { updatedEnvelopes: updated, sent, conflicts, pending };
}

function stableHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16);
}

function normalizeEnvelope(entry: unknown): LocalEvidenceEnvelope {
  if (!entry || typeof entry !== "object") {
    throw new Error("Evidence queue entry must be an object.");
  }
  const envelope = entry as Partial<LocalEvidenceEnvelope>;
  if (envelope.schemaVersion !== 1) {
    throw new Error("Unsupported evidence queue envelope version.");
  }
  if (!envelope.envelopeId || !envelope.idempotencyKey || !envelope.createdAt) {
    throw new Error("Evidence queue envelope is missing identity fields.");
  }
  if (!envelope.toolName || !envelope.payload || !envelope.target) {
    throw new Error("Evidence queue envelope is missing tool payload fields.");
  }
  const status = envelope.status ?? "queued";
  if (status !== "queued" && status !== "sent" && status !== "conflict") {
    throw new Error(`Unsupported evidence queue status: ${status}`);
  }
  return {
    schemaVersion: 1,
    envelopeId: envelope.envelopeId,
    idempotencyKey: envelope.idempotencyKey,
    createdAt: envelope.createdAt,
    target: envelope.target,
    toolName: envelope.toolName,
    payload: envelope.payload,
    status,
    lastAttemptAt: envelope.lastAttemptAt,
    remoteId: envelope.remoteId,
    lastError: envelope.lastError,
  };
}
