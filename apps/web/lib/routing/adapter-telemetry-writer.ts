// apps/web/lib/routing/adapter-telemetry-writer.ts
//
// Phase A7: One row per adapter execution attempt is written to
// `AdapterRunTelemetry` immediately after dispatch finishes (or fails). The
// writer is fire-and-forget — a Prisma write failure here must never break a
// coworker turn, so any thrown error is swallowed at the call site.
//
// The caller (`callProvider` in inference/ai-inference.ts) populates as many
// fields as it has in scope. Optional fields default to null so we capture
// useful rows even when context (agentId, skillId, threadId) hasn't been
// plumbed through yet — Phase A7 stays narrow; richer attribution flows
// through the call chain in follow-up phases.
//
// Plan: docs/superpowers/plans/2026-04-29-cli-execution-adapter-routing-plan.md (Task A7)
// Spec: docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md §4.3

import { prisma } from "@dpf/db";

/**
 * Caller-provided fields for one `AdapterRunTelemetry` row.
 *
 * Required fields match the non-null columns on the model. Everything else
 * is optional; we encourage callers to fill in what they have rather than
 * synthesizing placeholders, so analytics queries don't have to filter out
 * placeholder noise.
 */
export type AdapterTelemetryInput = {
  // Required
  adapterKind: string;
  adapterVersion: string;
  providerId: string;
  modelId: string;
  executionMode: string;
  startedAt: Date;
  status: string;
  traceId?: string;

  // Attribution (PR #607 + PR #623 conventions)
  threadId?: string;
  agentMessageId?: string;
  buildId?: string;
  agentId?: string;
  skillId?: string;

  // Race / shadow grouping
  raceCohortId?: string;

  // Lifecycle
  finishedAt?: Date;
  durationMs?: number;
  firstEventLatencyMs?: number;

  // Outcome detail
  refusalReason?: string;
  errorClass?: string;
  httpStatus?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  /** Tokens written into the Anthropic prompt cache this call. */
  cacheCreationInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  estimatedCostUsd?: number;
  quotaPoolConsumed?: string;

  // Tool-call validity
  toolCallsTotal?: number;
  toolCallsInvalid?: number;

  // Capability fidelity
  capabilitiesUsed?: string[];
  schemaDriftDetected?: boolean;

  // Acceptance — populated asynchronously by downstream signals, not here
  userAccepted?: boolean;
  acceptedAt?: Date;

  // For cross-adapter equivalence checks (shadow/race comparison)
  rawEventDigest?: string;
};

/**
 * Test-only override hook. When set, `writeAdapterTelemetry` calls this
 * instead of touching Prisma. Mirrors the pattern in
 * `mcp-governed-execute.ts`.
 */
let _writeOverride:
  | ((data: Record<string, unknown>) => Promise<unknown>)
  | null = null;

/** Test-only: install/clear the override. */
export function _setAdapterTelemetryWriteOverrideForTests(
  override:
    | ((data: Record<string, unknown>) => Promise<unknown>)
    | null,
): void {
  _writeOverride = override;
}

/**
 * Persist one `AdapterRunTelemetry` row. Fire-and-forget: any database error
 * is swallowed (logged to console.warn) so a telemetry write failure cannot
 * break a coworker turn. Callers should NOT `await` this function inside a
 * critical path — invoke it without `await`, after the user-visible response
 * has been computed.
 */
export async function writeAdapterTelemetry(
  input: AdapterTelemetryInput,
): Promise<void> {
  try {
    const data: Record<string, unknown> = {
      adapterKind: input.adapterKind,
      adapterVersion: input.adapterVersion,
      providerId: input.providerId,
      modelId: input.modelId,
      executionMode: input.executionMode,
      startedAt: input.startedAt,
      status: input.status,
    };
    if (input.traceId !== undefined) data.traceId = input.traceId;
    if (input.threadId !== undefined) data.threadId = input.threadId;
    if (input.agentMessageId !== undefined) data.agentMessageId = input.agentMessageId;
    if (input.buildId !== undefined) data.buildId = input.buildId;
    if (input.agentId !== undefined) data.agentId = input.agentId;
    if (input.skillId !== undefined) data.skillId = input.skillId;
    if (input.raceCohortId !== undefined) data.raceCohortId = input.raceCohortId;
    if (input.finishedAt !== undefined) data.finishedAt = input.finishedAt;
    if (input.durationMs !== undefined) data.durationMs = input.durationMs;
    if (input.firstEventLatencyMs !== undefined) data.firstEventLatencyMs = input.firstEventLatencyMs;
    if (input.refusalReason !== undefined) data.refusalReason = input.refusalReason;
    if (input.errorClass !== undefined) data.errorClass = input.errorClass;
    if (input.httpStatus !== undefined) data.httpStatus = input.httpStatus;
    if (input.inputTokens !== undefined) data.inputTokens = input.inputTokens;
    if (input.cachedInputTokens !== undefined) data.cachedInputTokens = input.cachedInputTokens;
    if (input.cacheCreationInputTokens !== undefined) data.cacheCreationInputTokens = input.cacheCreationInputTokens;
    if (input.outputTokens !== undefined) data.outputTokens = input.outputTokens;
    if (input.reasoningTokens !== undefined) data.reasoningTokens = input.reasoningTokens;
    if (input.estimatedCostUsd !== undefined) data.estimatedCostUsd = input.estimatedCostUsd;
    if (input.quotaPoolConsumed !== undefined) data.quotaPoolConsumed = input.quotaPoolConsumed;
    if (input.toolCallsTotal !== undefined) data.toolCallsTotal = input.toolCallsTotal;
    if (input.toolCallsInvalid !== undefined) data.toolCallsInvalid = input.toolCallsInvalid;
    if (input.capabilitiesUsed !== undefined) data.capabilitiesUsed = input.capabilitiesUsed;
    if (input.schemaDriftDetected !== undefined) data.schemaDriftDetected = input.schemaDriftDetected;
    if (input.userAccepted !== undefined) data.userAccepted = input.userAccepted;
    if (input.acceptedAt !== undefined) data.acceptedAt = input.acceptedAt;
    if (input.rawEventDigest !== undefined) data.rawEventDigest = input.rawEventDigest;

    if (_writeOverride) {
      await _writeOverride(data);
      return;
    }

    await prisma.adapterRunTelemetry.create({ data: data as never });
  } catch (e) {
    // Fire-and-forget pattern — telemetry must not break the user turn.
    // Mirrors prisma.toolExecution.create().catch(() => {}) in mcp-governed-execute.ts.
    // eslint-disable-next-line no-console
    console.warn("[adapter-telemetry-writer] write failed (suppressed):", e);
  }
}
