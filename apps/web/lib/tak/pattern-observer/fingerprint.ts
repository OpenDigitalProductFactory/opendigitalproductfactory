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

export type JsonEvidence =
  | null
  | boolean
  | number
  | string
  | JsonEvidence[]
  | { [key: string]: JsonEvidence };

export function capabilityNeedKey(agentId: string, kind: string, need: string): string {
  return capabilityNeedOriginId(agentId, kind, need);
}

export function improvementSignalKey(sourceType: string, sourceId: string): ImprovementSignalKey {
  return { sourceType, sourceId };
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableJson(value: unknown, path = "evidence"): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => stableJson(entry, `${path}[${index}]`)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    if (!isPlainObject(value)) {
      throw new TypeError(`Evidence fingerprint only supports JSON-compatible objects at ${path}`);
    }

    return `{${Object.entries(value)
      .sort(([left], [right]) => compareKeys(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry, `${path}.${key}`)}`)
      .join(",")}}`;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`Evidence fingerprint only supports finite numbers at ${path}`);
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Evidence fingerprint only supports JSON-compatible values at ${path}`);
  }

  if (typeof value === "bigint") {
    throw new TypeError(`Evidence fingerprint only supports JSON-compatible values at ${path}`);
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
