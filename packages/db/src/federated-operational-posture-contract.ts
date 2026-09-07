// EP cross-install operational control plane · Slice 2 Increment 1
// (BI-0585906E / parent BI-648F01A0). The federated record contract for a read-only
// operational-posture projection: each install is canonical for its OWN posture
// and projects a minimized, read-only rollup to same-organization peers. Mirrors
// the demand-envelope contract (federated-demand-contract.ts): a versioned type,
// a canonical content digest, and a pure conformance validator.
//
// CRITICAL minimization: this record egresses to a peer install. It carries only
// SUMMARY rollups — severity counts, health status, coarse runtime/resource tallies
// — never raw findings, hostnames, IPs, node IDs, or per-item estate rows. The type
// admits no such field, the projection template allow-lists only these fields, and
// the validator rejects host-identifying keys as a defensive double-check.

import { createHash } from "node:crypto";

import type { ProjectionContractSpec } from "./projection-serialization";

export const OPERATIONAL_POSTURE_SCHEMA_VERSIONS = ["dpf.operational-posture/1"] as const;
export type OperationalPostureSchemaVersion = (typeof OPERATIONAL_POSTURE_SCHEMA_VERSIONS)[number];

export const POSTURE_HEALTH_STATUSES = ["healthy", "degraded", "offline"] as const;

/** Outbound activity carried on the shared federation inbox for a posture report.
 *  One activity: the record is a singleton per origin install, so "reported"
 *  covers create and update alike (the peer reconciles by originVersion). */
export const OPERATIONAL_POSTURE_ACTIVITIES = ["dpf.operational-posture.reported"] as const;
export type OperationalPostureActivity = (typeof OPERATIONAL_POSTURE_ACTIVITIES)[number];
export type PostureHealthStatus = (typeof POSTURE_HEALTH_STATUSES)[number];

/** Summary count of open patch findings by severity — counts only, never the findings. */
export interface PosturePatchSummaryV1 {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** Small health rollup — a status band plus the size of the estate, no item rows. */
export interface PostureHealthRollupV1 {
  status: PostureHealthStatus;
  estateItemCount: number;
}

/** Coarse runtime tally — counts only, never hostnames/IPs/target identities. */
export interface PostureRuntimeSummaryV1 {
  targetCount: number;
  healthyCount: number;
}

/** Optional coarse numeric footprint. Every field is an optional non-negative number. */
export interface PostureResourceFootprintV1 {
  cpuCores?: number;
  memoryMb?: number;
  storageGb?: number;
}

export interface OperationalPostureV1 {
  specVersion: "dpf.operational-posture/1";
  /** The reporting install — canonical for its own posture. */
  originInstallationId: string;
  /** Derived from the source's updatedAt epoch ms, so re-projecting an unchanged
   *  posture is idempotent (same version, same digest). */
  originVersion: number;
  /** The version/build the install is currently serving. */
  servedVersion: string;
  /** The commit/image sha the install is currently serving. */
  servedSha: string;
  patchPosture: PosturePatchSummaryV1;
  health: PostureHealthRollupV1;
  runtime: PostureRuntimeSummaryV1;
  resourceFootprint?: PostureResourceFootprintV1;
  capturedAt: string;
  payloadDigest: string;
}

// Fields that must NEVER cross a federation boundary — host-identifying or raw
// estate detail that a minimization leak would expose. Rejected on receive as a
// defensive double-check of the sender's egress projection. Everything NOT on this
// denylist is tolerated (forward-compatible: a newer peer's additive summary field
// must not 422 an older receiver during a rolling upgrade). Keep in sync with the
// excludeSlices in OPERATIONAL_POSTURE_PROJECTION_TEMPLATE.
const FORBIDDEN_POSTURE_FIELDS = new Set([
  "hostname",
  "hostnames",
  "ipAddress",
  "ipAddresses",
  "macAddress",
  "nodeId",
  "nodeName",
  "endpoints",
  "urls",
  "findings",
  "rawFindings",
  "findingDetails",
  "targets",
  "targetDetails",
  "estateItems",
  "hostDetails",
]);

/** Minimized top-level field allow-list — only these leave the install. */
export const OPERATIONAL_POSTURE_FIELDS = [
  "specVersion",
  "originInstallationId",
  "originVersion",
  "servedVersion",
  "servedSha",
  "patchPosture",
  "health",
  "runtime",
  "resourceFootprint",
  "capturedAt",
  "payloadDigest",
];

/** Default minimum-necessary projection. Operators may narrow, never silently expand it. */
export const OPERATIONAL_POSTURE_PROJECTION_TEMPLATE: ProjectionContractSpec = {
  includeSlices: ["posture"],
  excludeSlices: ["hostDetails", "estateItems", "rawFindings", "runtimeTargets", "localBacklog"],
  fieldAllowList: { posture: OPERATIONAL_POSTURE_FIELDS },
  retentionClass: "short",
};

export interface OperationalPostureValidationContext {
  previousOriginVersion?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isNonNegativeInt(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Canonical content digest; the digest field itself is excluded. */
export function computeOperationalPosturePayloadDigest(
  value: Omit<OperationalPostureV1, "payloadDigest"> | OperationalPostureV1,
): string {
  const content = { ...(value as OperationalPostureV1) } as Record<string, unknown>;
  delete content.payloadDigest;
  return `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
}

/** Pure protocol conformance check used before persistence or semantic processing. */
export function validateOperationalPostureV1(
  value: unknown,
  context: OperationalPostureValidationContext = {},
): string[] {
  if (!isRecord(value)) return ["posture:invalid"];

  const violations: string[] = [];
  // Reject only host-identifying/raw leak fields (minimization double-check); tolerate
  // any other unknown/additive field so a newer peer doesn't 422 an older receiver during
  // a rolling upgrade. See FORBIDDEN_POSTURE_FIELDS.
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_POSTURE_FIELDS.has(key)) violations.push(`field:not-allowed:${key}`);
  }
  if (value.specVersion !== "dpf.operational-posture/1") violations.push("specVersion:unsupported");
  if (!isNonEmptyString(value.originInstallationId, 160)) violations.push("originInstallationId:invalid");
  if (!Number.isSafeInteger(value.originVersion) || Number(value.originVersion) < 1) {
    violations.push("originVersion:invalid");
  } else if (
    context.previousOriginVersion !== undefined
    && Number(value.originVersion) <= context.previousOriginVersion
  ) {
    violations.push("originVersion:not-advancing");
  }
  if (!isNonEmptyString(value.servedVersion, 80)) violations.push("servedVersion:invalid");
  if (!isNonEmptyString(value.servedSha, 128)) violations.push("servedSha:invalid");

  if (!isRecord(value.patchPosture)) {
    violations.push("patchPosture:invalid");
  } else {
    for (const severity of ["critical", "high", "medium", "low"] as const) {
      if (!isNonNegativeInt(value.patchPosture[severity])) violations.push(`patchPosture.${severity}:invalid`);
    }
  }

  if (!isRecord(value.health)) {
    violations.push("health:invalid");
  } else {
    if (!(POSTURE_HEALTH_STATUSES as readonly unknown[]).includes(value.health.status)) {
      violations.push("health.status:unsupported");
    }
    if (!isNonNegativeInt(value.health.estateItemCount)) violations.push("health.estateItemCount:invalid");
  }

  if (!isRecord(value.runtime)) {
    violations.push("runtime:invalid");
  } else {
    const targetOk = isNonNegativeInt(value.runtime.targetCount);
    const healthyOk = isNonNegativeInt(value.runtime.healthyCount);
    if (!targetOk) violations.push("runtime.targetCount:invalid");
    if (!healthyOk) violations.push("runtime.healthyCount:invalid");
    if (targetOk && healthyOk && Number(value.runtime.healthyCount) > Number(value.runtime.targetCount)) {
      violations.push("runtime.healthyCount:exceeds-target");
    }
  }

  if (value.resourceFootprint !== undefined) {
    if (!isRecord(value.resourceFootprint)) {
      violations.push("resourceFootprint:invalid");
    } else {
      for (const [key, footprintValue] of Object.entries(value.resourceFootprint)) {
        if (typeof footprintValue !== "number" || !Number.isFinite(footprintValue) || footprintValue < 0) {
          violations.push(`resourceFootprint.${key}:invalid`);
        }
      }
    }
  }

  if (!isIsoTimestamp(value.capturedAt)) violations.push("capturedAt:invalid");
  if (typeof value.payloadDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.payloadDigest)) {
    violations.push("payloadDigest:invalid");
  } else if (computeOperationalPosturePayloadDigest(value as unknown as OperationalPostureV1) !== value.payloadDigest) {
    violations.push("payloadDigest:mismatch");
  }

  return violations;
}
