// apps/web/lib/gear-interface/otel-exporter.ts
//
// Reduction Gear Phase 0 — best-effort OTel projection of GearInterface rows.
//
// Behind the DPF_GEAR_OTEL_EXPORT feature flag. When disabled (default) the
// exporter is a no-op so production deployments don't pay an OTel SDK weight
// they don't use. When enabled, it builds the attribute payload per spec §3.2:
// OTel-native attributes (gen_ai.*) for the things OTel already standardizes,
// and dpf.gear.* for what OTel is still silent on.
//
// Phase 0 does not depend on @opentelemetry/api as a runtime dep. We resolve
// the SDK lazily and degrade to a structured log line if it isn't installed,
// so the GearInterface DB write remains canonical and unblocked.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §3.2

import { Prisma } from "@dpf/db";

export type GearInterfaceRow = Prisma.GearInterfaceGetPayload<Record<string, never>>;

const FLAG_ENV = "DPF_GEAR_OTEL_EXPORT";

export function isOtelExportEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "TRUE";
}

/**
 * Build the OTel attribute payload for a GearInterface row. Pure — exposed for
 * tests. Maps OTel-native attributes where the GenAI/MCP semconv covers it,
 * and dpf.gear.* for DPF-specific dimensions OTel doesn't standardize yet.
 */
export function buildOtelAttributes(row: GearInterfaceRow): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    // dpf.gear.* — DPF-specific dimensions
    "dpf.gear.schema_version": row.schemaVersion,
    "dpf.gear.interface_class": row.interfaceClass,
    "dpf.gear.transmission_direction": row.transmissionDirection,
    "dpf.gear.shaft.source_type": row.shaftSourceType,
    "dpf.gear.shaft.source_id": row.shaftSourceId,
    "dpf.gear.capability.name": row.capabilityName,
    "dpf.gear.capability.vocabulary_version": row.capabilityVocabularyVersion,
    "dpf.gear.torque.technical": row.torqueTechnical,
    "dpf.gear.torque.confidence": row.torqueConfidence,
    "dpf.gear.ratio_consumed": row.ratioConsumed,
    "dpf.gear.outcome_type": row.outcomeType,
    "dpf.gear.slip.detected": row.slipDetected,
    "dpf.gear.grader.type": row.graderType,
  };

  if (row.innerRing != null) attrs["dpf.gear.inner_ring"] = row.innerRing;
  if (row.outerRing != null) attrs["dpf.gear.outer_ring"] = row.outerRing;
  if (row.archetypeContext) attrs["dpf.gear.capability.archetype_context"] = row.archetypeContext;
  if (row.torqueValue != null) attrs["dpf.gear.torque.value"] = row.torqueValue;
  if (row.slipReason) attrs["dpf.gear.slip.reason"] = row.slipReason;
  if (row.graderId) attrs["dpf.gear.grader.id"] = row.graderId;
  if (row.rationale) attrs["dpf.gear.grader.rationale"] = row.rationale;
  if (row.costUsd != null) attrs["dpf.gear.cost.usd"] = row.costUsd.toString();
  if (row.graduationFromAutonomy) attrs["dpf.gear.graduation.from_autonomy"] = row.graduationFromAutonomy;
  if (row.graduationToAutonomy) attrs["dpf.gear.graduation.to_autonomy"] = row.graduationToAutonomy;
  if (row.graduationSampleSize != null) attrs["dpf.gear.graduation.sample_size"] = row.graduationSampleSize;
  if (row.externalCounterpartyType) attrs["dpf.gear.external.counterparty_type"] = row.externalCounterpartyType;
  if (row.externalCounterpartyId) attrs["dpf.gear.external.counterparty_id"] = row.externalCounterpartyId;

  // gen_ai.* — OTel-native attributes. Tokens map directly; operation name is
  // exporter-derived (we cannot guess invoke_agent vs execute_tool from the
  // outcome alone, so we map the shaft source type into an operation hint and
  // let downstream pipelines refine).
  const operationByShaft: Record<string, string> = {
    "tool-execution": "execute_tool",
    "a2a-thread": "invoke_workflow",
    "phase-run": "invoke_workflow",
    deliberation: "invoke_workflow",
    "runtime-verification": "invoke_workflow",
  };
  const op = operationByShaft[row.shaftSourceType];
  if (op) attrs["gen_ai.operation.name"] = op;

  if (row.inputTokens != null) attrs["gen_ai.usage.input_tokens"] = row.inputTokens;
  if (row.outputTokens != null) attrs["gen_ai.usage.output_tokens"] = row.outputTokens;
  if (row.cacheCreationInputTokens != null) {
    attrs["gen_ai.usage.cache_creation_input_tokens"] = row.cacheCreationInputTokens;
  }
  if (row.cacheReadInputTokens != null) {
    attrs["gen_ai.usage.cache_read_input_tokens"] = row.cacheReadInputTokens;
  }
  if (row.reasoningOutputTokens != null) {
    attrs["gen_ai.usage.reasoning_output_tokens"] = row.reasoningOutputTokens;
  }

  return attrs;
}

/** Span name per spec §3.2. */
export function buildOtelSpanName(row: GearInterfaceRow): string {
  if (row.interfaceClass === "internal-adjacent") {
    const dir = row.transmissionDirection === "inward" ? "from" : "to";
    return `dpf.gear.transmit ring${row.innerRing}_${dir}_ring${row.outerRing} ${row.capabilityName}`;
  }
  return `dpf.gear.external ${row.interfaceClass} ${row.capabilityName}`;
}

/**
 * Export one GearInterface row to OTel. No-op when the feature flag is off.
 * Falls back to a structured console log when @opentelemetry/api isn't
 * resolvable — keeps the DB write canonical regardless of SDK state.
 */
export async function exportGearInterfaceToOtel(row: GearInterfaceRow): Promise<void> {
  if (!isOtelExportEnabled()) return;

  const spanName = buildOtelSpanName(row);
  const attributes = buildOtelAttributes(row);

  type OtelApi = {
    trace: {
      getTracer: (name: string) => {
        startSpan: (
          name: string,
          options: { startTime?: Date; attributes: Record<string, unknown> },
        ) => { end: (when?: Date) => void };
      };
    };
  };

  let api: OtelApi | null = null;
  try {
    api = (await import("@opentelemetry/api")) as unknown as OtelApi;
  } catch {
    // SDK not installed; log the payload so it is observable.
    console.log("[gear-interface][otel] (no SDK)", JSON.stringify({ spanName, attributes }));
    return;
  }

  const tracer = api.trace.getTracer("dpf.gear");
  const span = tracer.startSpan(spanName, {
    startTime: row.sourceEventAt ?? row.recordedAt,
    attributes,
  });
  span.end(row.recordedAt);
}
