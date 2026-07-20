import { createHash } from "node:crypto";

import type { FederationRelationshipPreset } from "./federation-link-types";
import type { ProjectionContractSpec } from "./projection-serialization";

export const DEMAND_SCHEMA_VERSIONS = ["dpf.demand/1"] as const;
export type DemandSchemaVersion = (typeof DEMAND_SCHEMA_VERSIONS)[number];

export const DEMAND_ACTIVITIES = [
  "dpf.demand.proposed",
  "dpf.demand.updated",
  "dpf.demand.withdrawn",
  "dpf.demand.interest-recorded",
  "dpf.demand.help-offered",
  "dpf.demand.adopted",
  "dpf.demand.dispositioned",
  "dpf.release.applicability-published",
] as const;
export type DemandActivity = (typeof DEMAND_ACTIVITIES)[number];

export const DEMAND_AUDIENCES = ["internal", "partner", "founder", "community"] as const;
export type DemandAudience = (typeof DEMAND_AUDIENCES)[number];

export const DEMAND_ATTRIBUTIONS = ["named", "organization", "pseudonymous", "anonymous"] as const;
export type DemandAttribution = (typeof DEMAND_ATTRIBUTIONS)[number];

export interface DemandRouteHopV1 {
  installationId: string;
  relationshipKind: string;
  receivedAt: string;
  attestationDigest: string;
}

export interface DemandEnvelopeV1 {
  specVersion: "dpf.demand/1";
  envelopeId: string;
  originInstallationId: string;
  originRecordRef: string;
  originVersion: number;
  route: DemandRouteHopV1[];
  audience: DemandAudience;
  title: string;
  summary: string;
  workType?: string;
  applicability?: {
    product?: string;
    capabilityRefs?: string[];
    archetypeRefs?: string[];
    platformRange?: string;
  };
  evidence?: Array<{ kind: string; digest: string; safeRef?: string }>;
  signal: { occurrenceCount: number; affectedOrganizations?: number };
  attribution: DemandAttribution;
  /** Source-owned consent for a downstream intermediary to forward this
   * minimized envelope. Absence means forwarding is forbidden. */
  forwarding?: {
    permitted: boolean;
    audiences: DemandAudience[];
    expiresAt?: string;
  };
  createdAt: string;
  updatedAt: string;
  payloadDigest: string;
}

export interface DemandDigestRecordV1 {
  originRecordRef: string;
  originVersion: number;
  payloadDigest: string;
  withdrawn: boolean;
}

export interface DemandDigestV1 {
  specVersion: "dpf.demand-digest/1";
  originInstallationId: string;
  generatedAt: string;
  records: DemandDigestRecordV1[];
}

export const DEMAND_RESPONSE_KINDS = ["interest", "help-offer"] as const;
export type DemandResponseKind = (typeof DEMAND_RESPONSE_KINDS)[number];

export interface DemandResponseV1 {
  specVersion: "dpf.demand-response/1";
  responseId: string;
  envelopeId: string;
  originInstallationId: string;
  originRecordRef: string;
  responseKind: DemandResponseKind;
  message?: string;
  responderAttribution: DemandAttribution;
  createdAt: string;
  payloadDigest: string;
}

const REQUIRED_FIELDS = [
  "specVersion",
  "envelopeId",
  "originInstallationId",
  "originRecordRef",
  "originVersion",
  "route",
  "audience",
  "title",
  "summary",
  "signal",
  "attribution",
  "createdAt",
  "updatedAt",
  "payloadDigest",
];

const COLLABORATIVE_FIELDS = [
  ...REQUIRED_FIELDS,
  "workType",
  "applicability",
  "evidence",
  "forwarding",
];

const PARTNER_FIELDS = [
  ...REQUIRED_FIELDS,
  "workType",
  "applicability",
  "forwarding",
];

const COMMUNITY_FIELDS = [
  ...REQUIRED_FIELDS,
  "applicability",
];

const DEMAND_ENVELOPE_V1_FIELDS = new Set(COLLABORATIVE_FIELDS);

function projection(fields: string[], retentionClass: ProjectionContractSpec["retentionClass"]): ProjectionContractSpec {
  return {
    includeSlices: ["demand"],
    excludeSlices: ["localBacklog", "workCapsule", "privatePlanning", "attachments", "customerContext"],
    fieldAllowList: { demand: fields },
    retentionClass,
  };
}

/** Default minimum-necessary starting points. Operators may narrow, never silently expand them. */
export const DEMAND_PROJECTION_TEMPLATES: Record<FederationRelationshipPreset, ProjectionContractSpec> = {
  "same-organization": projection(COLLABORATIVE_FIELDS, "standard"),
  "service-provider": projection(PARTNER_FIELDS, "short"),
  channel: projection(PARTNER_FIELDS, "standard"),
  "community-peer": projection(COMMUNITY_FIELDS, "short"),
};

export interface DemandEnvelopeValidationContext {
  receivingInstallationId?: string;
  previousOriginVersion?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max;
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
export function computeDemandPayloadDigest(value: Omit<DemandEnvelopeV1, "payloadDigest"> | DemandEnvelopeV1): string {
  const content = { ...(value as DemandEnvelopeV1) } as Record<string, unknown>;
  delete content.payloadDigest;
  return `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
}

export function computeDemandResponseDigest(
  value: Omit<DemandResponseV1, "payloadDigest"> | DemandResponseV1,
): string {
  const content = { ...(value as DemandResponseV1) } as Record<string, unknown>;
  delete content.payloadDigest;
  return `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
}

export function validateDemandResponseV1(value: unknown): string[] {
  if (!isRecord(value)) return ["response:invalid"];
  const allowed = new Set([
    "specVersion", "responseId", "envelopeId", "originInstallationId",
    "originRecordRef", "responseKind", "message", "responderAttribution",
    "createdAt", "payloadDigest",
  ]);
  const violations: string[] = [];
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) violations.push(`field:not-allowed:${key}`);
  }
  if (value.specVersion !== "dpf.demand-response/1") violations.push("specVersion:unsupported");
  if (!isNonEmptyString(value.responseId, 160)) violations.push("responseId:invalid");
  if (!isNonEmptyString(value.envelopeId, 160)) violations.push("envelopeId:invalid");
  if (!isNonEmptyString(value.originInstallationId, 160)) violations.push("originInstallationId:invalid");
  if (!isNonEmptyString(value.originRecordRef, 240)) violations.push("originRecordRef:invalid");
  if (!(DEMAND_RESPONSE_KINDS as readonly unknown[]).includes(value.responseKind)) {
    violations.push("responseKind:unsupported");
  }
  if (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 1_000)) {
    violations.push("message:invalid");
  }
  if (!(DEMAND_ATTRIBUTIONS as readonly unknown[]).includes(value.responderAttribution)) {
    violations.push("responderAttribution:unsupported");
  }
  if (!isIsoTimestamp(value.createdAt)) violations.push("createdAt:invalid");
  if (typeof value.payloadDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.payloadDigest)) {
    violations.push("payloadDigest:invalid");
  } else if (computeDemandResponseDigest(value as unknown as DemandResponseV1) !== value.payloadDigest) {
    violations.push("payloadDigest:mismatch");
  }
  return violations;
}

/** Pure protocol conformance check used before persistence or semantic processing. */
export function validateDemandEnvelopeV1(
  value: unknown,
  context: DemandEnvelopeValidationContext = {},
): string[] {
  if (!isRecord(value)) return ["envelope:invalid"];

  const violations: string[] = [];
  for (const key of Object.keys(value)) {
    if (!DEMAND_ENVELOPE_V1_FIELDS.has(key)) violations.push(`field:not-allowed:${key}`);
  }
  if (value.specVersion !== "dpf.demand/1") violations.push("specVersion:unsupported");
  if (!isNonEmptyString(value.envelopeId, 160)) violations.push("envelopeId:invalid");
  if (!isNonEmptyString(value.originInstallationId, 160)) violations.push("originInstallationId:invalid");
  if (!isNonEmptyString(value.originRecordRef, 240)) violations.push("originRecordRef:invalid");
  if (!Number.isSafeInteger(value.originVersion) || Number(value.originVersion) < 1) {
    violations.push("originVersion:invalid");
  } else if (
    context.previousOriginVersion !== undefined
    && Number(value.originVersion) <= context.previousOriginVersion
  ) {
    violations.push("originVersion:not-advancing");
  }
  if (!(DEMAND_AUDIENCES as readonly unknown[]).includes(value.audience)) violations.push("audience:unsupported");
  if (!isNonEmptyString(value.title, 240)) {
    violations.push(typeof value.title === "string" && value.title.length > 240 ? "title:too-long" : "title:invalid");
  }
  if (!isNonEmptyString(value.summary, 4_000)) {
    violations.push(typeof value.summary === "string" && value.summary.length > 4_000 ? "summary:too-long" : "summary:invalid");
  }
  if (!(DEMAND_ATTRIBUTIONS as readonly unknown[]).includes(value.attribution)) violations.push("attribution:unsupported");
  if (value.forwarding !== undefined) {
    if (!isRecord(value.forwarding)) {
      violations.push("forwarding:invalid");
    } else {
      if (typeof value.forwarding.permitted !== "boolean") violations.push("forwarding.permitted:invalid");
      if (!Array.isArray(value.forwarding.audiences) || value.forwarding.audiences.length > 4) {
        violations.push("forwarding.audiences:invalid");
      } else if (value.forwarding.audiences.some(
        (audience) => !(DEMAND_AUDIENCES as readonly unknown[]).includes(audience),
      )) {
        violations.push("forwarding.audiences:unsupported");
      }
      if (value.forwarding.expiresAt !== undefined && !isIsoTimestamp(value.forwarding.expiresAt)) {
        violations.push("forwarding.expiresAt:invalid");
      }
    }
  }
  if (!isIsoTimestamp(value.createdAt)) violations.push("createdAt:invalid");
  if (!isIsoTimestamp(value.updatedAt)) violations.push("updatedAt:invalid");
  if (typeof value.payloadDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.payloadDigest)) {
    violations.push("payloadDigest:invalid");
  } else if (computeDemandPayloadDigest(value as unknown as DemandEnvelopeV1) !== value.payloadDigest) {
    violations.push("payloadDigest:mismatch");
  }

  if (!isRecord(value.signal)) {
    violations.push("signal:invalid");
  } else {
    if (!Number.isSafeInteger(value.signal.occurrenceCount) || Number(value.signal.occurrenceCount) < 0) {
      violations.push("signal.occurrenceCount:invalid");
    }
    if (
      value.signal.affectedOrganizations !== undefined
      && (!Number.isSafeInteger(value.signal.affectedOrganizations) || Number(value.signal.affectedOrganizations) < 0)
    ) {
      violations.push("signal.affectedOrganizations:invalid");
    }
  }

  if (!Array.isArray(value.route)) {
    violations.push("route:invalid");
  } else if (value.route.length > 8) {
    violations.push("route:too-many-hops");
  } else {
    const seen = new Set<string>();
    for (const hop of value.route) {
      if (!isRecord(hop) || !isNonEmptyString(hop.installationId, 160)) {
        violations.push("route:invalid-hop");
        continue;
      }
      const installationId = hop.installationId as string;
      if (seen.has(installationId)) violations.push(`route:duplicate-installation:${installationId}`);
      seen.add(installationId);
      if (installationId === context.receivingInstallationId) violations.push("route:receiver-loop");
      if (!isNonEmptyString(hop.relationshipKind, 80)) violations.push("route:invalid-relationship");
      if (!isIsoTimestamp(hop.receivedAt)) violations.push("route:invalid-received-at");
      if (!isNonEmptyString(hop.attestationDigest, 256)) violations.push("route:invalid-attestation");
    }
  }

  if (Array.isArray(value.evidence) && value.evidence.length > 20) violations.push("evidence:too-many-items");
  return violations;
}

/** Validate the bounded inventory used to repair lost deliveries/acknowledgments. */
export function validateDemandDigestV1(value: unknown): string[] {
  if (!isRecord(value)) return ["digest:invalid"];
  const violations: string[] = [];
  if (value.specVersion !== "dpf.demand-digest/1") violations.push("specVersion:unsupported");
  if (!isNonEmptyString(value.originInstallationId, 160)) violations.push("originInstallationId:invalid");
  if (!isIsoTimestamp(value.generatedAt)) violations.push("generatedAt:invalid");
  if (!Array.isArray(value.records)) return [...violations, "records:invalid"];
  if (value.records.length > 1_000) violations.push("records:too-many");
  for (const [index, record] of value.records.slice(0, 1_000).entries()) {
    if (!isRecord(record)) {
      violations.push(`records.${index}:invalid`);
      continue;
    }
    if (!isNonEmptyString(record.originRecordRef, 240)) violations.push(`records.${index}.originRecordRef:invalid`);
    if (!Number.isSafeInteger(record.originVersion) || Number(record.originVersion) < 1) {
      violations.push(`records.${index}.originVersion:invalid`);
    }
    if (!isNonEmptyString(record.payloadDigest, 256)) violations.push(`records.${index}.payloadDigest:invalid`);
    if (typeof record.withdrawn !== "boolean") violations.push(`records.${index}.withdrawn:invalid`);
  }
  return violations;
}
