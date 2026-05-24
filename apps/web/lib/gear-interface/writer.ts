// apps/web/lib/gear-interface/writer.ts
//
// Reduction Gear Phase 0 — single writer service for the GearInterface stream.
//
// All emission MUST go through emitGearInterface(). Do not scatter
// `prisma.gearInterface.create(...)` calls across the codebase — spec §9.1
// reserves the 20% refactoring allocation specifically to keep this seam clean.
//
// The writer:
//   1. Derives a deterministic idempotency key (or accepts an explicit override)
//   2. Validates spec §3.1 invariants pre-write (better errors than DB CHECK)
//   3. Upserts on conflict so dual-emit retries / replays are safe
//   4. Best-effort emission to the OTel exporter when the feature flag is on
//   5. Never throws — failures log and return null. Adapters that need to know
//      success can inspect the return.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §3.1
// BI:   BI-85CB31F0

import { prisma } from "@dpf/db";
import { exportGearInterfaceToOtel } from "./otel-exporter";
import type { GearInterfaceInput } from "./types";

/**
 * Derive the deterministic idempotency key from the input.
 *
 * Format (spec §3.1):
 *   {interfaceClass}:{innerRing}:{outerRing}:{transmissionDirection}:{shaftSourceType}:{shaftSourceId}:{outcomeType}[:{suffix}]
 *
 * `innerRing` / `outerRing` are rendered as `null` when absent so external
 * records still produce stable keys.
 */
export function deriveIdempotencyKey(input: GearInterfaceInput): string {
  const direction = input.transmissionDirection ?? "outward";
  const inner = input.innerRing == null ? "null" : String(input.innerRing);
  const outer = input.outerRing == null ? "null" : String(input.outerRing);
  const base = [
    input.interfaceClass,
    inner,
    outer,
    direction,
    input.shaftSourceType,
    input.shaftSourceId,
    input.outcomeType,
  ].join(":");
  return input.idempotencyKeySuffix ? `${base}:${input.idempotencyKeySuffix}` : base;
}

class GearInterfaceValidationError extends Error {}

/**
 * Validate invariants from spec §3.1 before write. The DB has matching CHECK
 * constraints, but pre-write validation produces clearer error messages and
 * makes the contract testable without a live DB.
 */
export function validateGearInterfaceInput(input: GearInterfaceInput): void {
  const direction = input.transmissionDirection ?? "outward";

  if (input.interfaceClass === "internal-adjacent") {
    if (input.innerRing == null || input.outerRing == null) {
      throw new GearInterfaceValidationError(
        "internal-adjacent requires innerRing and outerRing",
      );
    }
    if (input.innerRing < 1 || input.innerRing > 5 || input.outerRing < 1 || input.outerRing > 5) {
      throw new GearInterfaceValidationError(
        `ring numbers must be 1..5 (got inner=${input.innerRing}, outer=${input.outerRing})`,
      );
    }
    if (input.outerRing !== input.innerRing + 1) {
      throw new GearInterfaceValidationError(
        `internal-adjacent requires outerRing = innerRing + 1 (got inner=${input.innerRing}, outer=${input.outerRing})`,
      );
    }
    if (direction === "lateral") {
      throw new GearInterfaceValidationError(
        "internal-adjacent must use direction='outward' or 'inward', not 'lateral'",
      );
    }
  }

  if (input.interfaceClass.startsWith("external-")) {
    if (!input.externalCounterpartyType) {
      throw new GearInterfaceValidationError(
        `${input.interfaceClass} requires externalCounterpartyType`,
      );
    }
  }

  if (direction === "lateral" && !input.interfaceClass.startsWith("external-")) {
    throw new GearInterfaceValidationError(
      "direction='lateral' is reserved for external-* interfaceClass values",
    );
  }

  if (input.outcomeType === "graduation") {
    if (
      !input.graduationFromAutonomy ||
      !input.graduationToAutonomy ||
      !input.graduationGovernorRef
    ) {
      throw new GearInterfaceValidationError(
        "outcomeType='graduation' requires graduationFromAutonomy, graduationToAutonomy, and graduationGovernorRef",
      );
    }
  }

  if (input.torqueTechnical < 0 || input.torqueTechnical > 1) {
    throw new GearInterfaceValidationError(
      `torqueTechnical must be in [0,1] (got ${input.torqueTechnical})`,
    );
  }
  if (input.torqueConfidence < 0 || input.torqueConfidence > 1) {
    throw new GearInterfaceValidationError(
      `torqueConfidence must be in [0,1] (got ${input.torqueConfidence})`,
    );
  }
  if (
    input.torqueValue != null &&
    (input.torqueValue < 0 || input.torqueValue > 1)
  ) {
    throw new GearInterfaceValidationError(
      `torqueValue must be in [0,1] when present (got ${input.torqueValue})`,
    );
  }

  if (input.ratioConsumed < 0 || !Number.isInteger(input.ratioConsumed)) {
    throw new GearInterfaceValidationError(
      `ratioConsumed must be a non-negative integer (got ${input.ratioConsumed})`,
    );
  }

  // Ring 2→3 and outer interfaces require archetype context (spec §3.3). At
  // Ring 1→2 archetype context is allowed null because the work may be
  // archetype-agnostic.
  if (
    input.interfaceClass === "internal-adjacent" &&
    input.innerRing != null &&
    input.innerRing >= 2 &&
    !input.archetypeContext
  ) {
    throw new GearInterfaceValidationError(
      `archetypeContext is required at Ring ${input.innerRing}↔${input.outerRing} (spec §3.3)`,
    );
  }
}

export interface EmitResult {
  id: string;
  idempotencyKey: string;
  isNew: boolean;
}

/**
 * Emit one GearInterface row. Idempotent — repeated calls with the same
 * derived key upsert the same row. Never throws; logs and returns null on
 * failure so a DB hiccup never blocks the producing flow.
 */
export async function emitGearInterface(
  input: GearInterfaceInput,
): Promise<EmitResult | null> {
  try {
    validateGearInterfaceInput(input);
  } catch (err) {
    console.warn(
      "[gear-interface] Validation failed; skipping emit:",
      { shaftSourceType: input.shaftSourceType, shaftSourceId: input.shaftSourceId },
      err,
    );
    return null;
  }

  const idempotencyKey = input.idempotencyKey ?? deriveIdempotencyKey(input);
  const direction = input.transmissionDirection ?? "outward";

  const data = {
    idempotencyKey,
    organizationId: input.organizationId ?? null,
    interfaceClass: input.interfaceClass,
    transmissionDirection: direction,
    innerRing: input.innerRing ?? null,
    outerRing: input.outerRing ?? null,
    externalCounterpartyType: input.externalCounterpartyType ?? null,
    externalCounterpartyId: input.externalCounterpartyId ?? null,
    shaftSourceType: input.shaftSourceType,
    shaftSourceId: input.shaftSourceId,
    sourceEventAt: input.sourceEventAt ?? null,
    actorType: input.actorType,
    actorId: input.actorId,
    actorPrincipalId: input.actorPrincipalId ?? null,
    intent: input.intent,
    capabilityName: input.capabilityName,
    capabilityVocabularyVersion: input.capabilityVocabularyVersion ?? "raw-v0",
    archetypeContext: input.archetypeContext ?? null,
    agentIdForTriple: input.agentIdForTriple,
    torqueTechnical: input.torqueTechnical,
    torqueValue: input.torqueValue ?? null,
    torqueConfidence: input.torqueConfidence,
    ratioConsumed: input.ratioConsumed,
    outcomeType: input.outcomeType,
    slipDetected: input.slipDetected ?? false,
    slipReason: input.slipReason ?? null,
    costUsd: input.costUsd != null ? input.costUsd.toString() : null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    cacheCreationInputTokens: input.cacheCreationInputTokens ?? null,
    cacheReadInputTokens: input.cacheReadInputTokens ?? null,
    reasoningOutputTokens: input.reasoningOutputTokens ?? null,
    durationMs: input.durationMs ?? null,
    graduationFromAutonomy: input.graduationFromAutonomy ?? null,
    graduationToAutonomy: input.graduationToAutonomy ?? null,
    graduationSampleSize: input.graduationSampleSize ?? null,
    graduationGovernorRef: input.graduationGovernorRef ?? null,
    graderType: input.graderType,
    graderId: input.graderId ?? null,
    rationale: input.rationale ?? null,
    otelTraceId: input.otelTraceId ?? null,
    otelSpanId: input.otelSpanId ?? null,
  };

  try {
    // Upsert keyed on idempotencyKey. On a conflict we leave the existing row
    // alone (first write wins) — replays should be no-ops, not silent rewrites.
    const existing = await prisma.gearInterface.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });

    if (existing) {
      return { id: existing.id, idempotencyKey, isNew: false };
    }

    const row = await prisma.gearInterface.create({ data });

    // Best-effort OTel projection. Never blocks the DB write.
    void exportGearInterfaceToOtel(row).catch((err) => {
      console.warn("[gear-interface] OTel export failed:", err);
    });

    return { id: row.id, idempotencyKey, isNew: true };
  } catch (err) {
    console.warn(
      "[gear-interface] Failed to write GearInterface row:",
      { idempotencyKey, shaftSourceType: input.shaftSourceType },
      err,
    );
    return null;
  }
}

export { GearInterfaceValidationError };
