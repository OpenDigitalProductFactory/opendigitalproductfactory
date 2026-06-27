import { createHash } from "node:crypto";

import { capabilityNeedOriginId } from "@/lib/coworker-self-assessment/assessment-service";

export type ImprovementSignalKey = {
  sourceType: string;
  sourceId: string;
};

export type EvidenceFingerprintInput = {
  agentId: string;
  routeContext?: string | null;
  kind: string;
  need: string;
  evidence?: unknown;
};

export function capabilityNeedKey(agentId: string, kind: string, need: string): string {
  return capabilityNeedOriginId(agentId, kind, need);
}

export function improvementSignalKey(sourceType: string, sourceId: string): ImprovementSignalKey {
  return { sourceType, sourceId };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).sort().join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

export function evidenceFingerprint(input: EvidenceFingerprintInput): string {
  return createHash("sha256")
    .update(
      stableJson({
        capabilityNeedKey: capabilityNeedKey(input.agentId, input.kind, input.need),
        routeContext: input.routeContext ?? null,
        evidence: input.evidence ?? null,
      }),
    )
    .digest("hex");
}
