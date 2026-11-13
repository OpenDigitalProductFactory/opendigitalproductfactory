import { createHash } from "node:crypto";

import type { FederationRelationshipPreset } from "./federation-link-types";
import type { ProjectionContractSpec } from "./projection-serialization";
import { isRecord } from "@dpf/validators";

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
  /** Per-installation causal-ordering vector (BI-67315C4A). Optional for
   *  back-compat; when present, the receiver uses it (not the scalar
   *  originVersion) to detect clean-newer vs a concurrent conflict. Deliberately
   *  EXCLUDED from payloadDigest so re-projecting an unchanged record stays
   *  idempotent while the vector still advances on real changes. */
  versionVector?: Record<string, number>;
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

/**
 * The heaviest an interest response may weigh (BI-626A4ECA). Each installation
 * spends a quadratic per-week credit budget, so weight N costs N^2 credits; the
 * budget itself is enforced by the voter, never by the wire.
 */
export const DEMAND_RESPONSE_MAX_WEIGHT = 4;

export interface DemandResponseV1 {
  specVersion: "dpf.demand-response/1";
  responseId: string;
  envelopeId: string;
  originInstallationId: string;
  originRecordRef: string;
  responseKind: DemandResponseKind;
  message?: string;
  /**
   * How much this interest matters to the responder, 1..DEMAND_RESPONSE_MAX_WEIGHT
   * (BI-626A4ECA). ABSENT MEANS 1: weight 1 is never written, so every response
   * sent before this field existed keeps its digest and nothing re-sends. Only an
   * interest response carries a weight.
   */
  weight?: number;
  responderAttribution: DemandAttribution;
  /** Present when the help offer asks the item's home for its claim
   *  (BI-30EDDB7F, spec 2026-10-27 §5.2). The subject is then a work-synced
   *  item, not a projected demand envelope: `originRecordRef` is the home's
   *  item id and `envelopeId` is `work:<itemId>`. */
  workClaim?: WorkClaimRequestV1;
  createdAt: string;
  payloadDigest: string;
}

/** What a claim request asks the item's home to do with its Workroom claim. */
export const WORK_CLAIM_ACTIONS = ["claim", "renew", "release"] as const;
export type WorkClaimAction = (typeof WORK_CLAIM_ACTIONS)[number];

/** How a released claim ended, which decides how the home closes its Workroom. */
export const WORK_CLAIM_RELEASE_REASONS = ["finished", "abandoned"] as const;
export type WorkClaimReleaseReason = (typeof WORK_CLAIM_RELEASE_REASONS)[number];

export interface WorkClaimRequestV1 {
  /** The item's id at its home. */
  itemId: string;
  action: WorkClaimAction;
  /** The installation asking, by its federation installation id (`inst_…`). */
  requesterInstallationId: string;
  /** The requester's own Workroom, which is the claim's fence. */
  requesterWorkroomId: string;
  repositoryFullName: string;
  headBranch: string;
  /** Required with `release`. */
  releaseReason?: WorkClaimReleaseReason;
}

/** The envelope id a work claim response carries, since it answers no envelope. */
export function workClaimEnvelopeId(itemId: string): string {
  return `work:${itemId}`;
}

/** `owner/name`, as GitHub names a repository. */
const REPOSITORY_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** A branch name git would accept (git check-ref-format, conservatively):
 *  no whitespace or control characters, none of ~^:?*[\, no "..", no "@{",
 *  no leading "-" or "/", no trailing "/", "." or ".lock". */
function isGitBranchName(value: string): boolean {
  return !/[\s\x00-\x1f\x7f~^:?*[\\]/.test(value)
    && !value.includes("..") && !value.includes("@{") && !value.includes("//")
    && !value.startsWith("-") && !value.startsWith("/")
    && !value.endsWith("/") && !value.endsWith(".") && !value.endsWith(".lock");
}

function validateWorkClaimRequestV1(value: unknown): string[] {
  if (!isRecord(value)) return ["workClaim:invalid"];
  const violations: string[] = [];
  if (!isNonEmptyString(value.itemId, 120)) violations.push("workClaim.itemId:invalid");
  if (!(WORK_CLAIM_ACTIONS as readonly unknown[]).includes(value.action)) violations.push("workClaim.action:unsupported");
  if (!isNonEmptyString(value.requesterInstallationId, 160)) violations.push("workClaim.requesterInstallationId:invalid");
  if (!isNonEmptyString(value.requesterWorkroomId, 120)) violations.push("workClaim.requesterWorkroomId:invalid");
  if (!isNonEmptyString(value.repositoryFullName, 200) || !REPOSITORY_FULL_NAME.test(String(value.repositoryFullName))) {
    violations.push("workClaim.repositoryFullName:invalid");
  }
  if (!isNonEmptyString(value.headBranch, 250) || !isGitBranchName(String(value.headBranch))) {
    violations.push("workClaim.headBranch:invalid");
  }
  if (value.action === "release") {
    if (!(WORK_CLAIM_RELEASE_REASONS as readonly unknown[]).includes(value.releaseReason)) {
      violations.push("workClaim.releaseReason:unsupported");
    }
  } else if (value.releaseReason !== undefined) {
    violations.push("workClaim.releaseReason:not-allowed");
  }
  return violations;
}

export const DEMAND_DISPOSITIONS = ["accepted", "rejected", "archived"] as const;
export type DemandDispositionDecision = (typeof DEMAND_DISPOSITIONS)[number];

export interface DemandDispositionNoticeV1 {
  specVersion: "dpf.demand-disposition/1";
  noticeId: string;
  envelopeId: string;
  originInstallationId: string;
  decision: DemandDispositionDecision;
  message?: string;
  releaseApplicability?: { releaseRef?: string; applicability: string };
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
  "versionVector",
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

// Fields that must NEVER cross a federation boundary — source-local planning/context
// that a minimization leak would expose. These are rejected on receive as a defensive
// double-check of the sender's egress projection. Everything NOT on this denylist is
// tolerated (forward-compatible: a newer peer's additive fields — e.g. versionVector —
// must not 422 an older receiver during a rolling upgrade; only known fields are
// processed). Kernel DI-71DEBCC9C45E. Keep in sync with the excludeSlices in
// DEMAND_PROJECTION_TEMPLATES.
const FORBIDDEN_FEDERATION_FIELDS = new Set([
  "backlogItemId",
  "workCapsule",
  "workCapsuleId",
  "priority",
  "localBacklog",
  "privatePlanning",
  "attachments",
  "customerContext",
]);

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
  // The version vector is causal-ordering metadata, not content: excluding it
  // keeps an unchanged re-projection digest-identical (idempotent noop) while the
  // vector still advances on real content changes. See DemandEnvelopeV1.
  delete content.versionVector;
  return `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
}

export function computeDemandResponseDigest(
  value: Omit<DemandResponseV1, "payloadDigest"> | DemandResponseV1,
): string {
  const content = { ...(value as DemandResponseV1) } as Record<string, unknown>;
  delete content.payloadDigest;
  return `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
}

export function computeDemandDispositionDigest(
  value: Omit<DemandDispositionNoticeV1, "payloadDigest"> | DemandDispositionNoticeV1,
): string {
  const content = { ...(value as DemandDispositionNoticeV1) } as Record<string, unknown>;
  delete content.payloadDigest;
  return `sha256:${createHash("sha256").update(stableJson(content)).digest("hex")}`;
}

export function validateDemandDispositionNoticeV1(value: unknown): string[] {
  if (!isRecord(value)) return ["notice:invalid"];
  const violations: string[] = [];
  // Reject only source-local leak fields; tolerate other unknown/additive fields
  // (forward-compat rolling upgrades). See FORBIDDEN_FEDERATION_FIELDS.
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FEDERATION_FIELDS.has(key)) violations.push(`field:not-allowed:${key}`);
  }
  if (value.specVersion !== "dpf.demand-disposition/1") violations.push("specVersion:unsupported");
  if (!isNonEmptyString(value.noticeId, 160)) violations.push("noticeId:invalid");
  if (!isNonEmptyString(value.envelopeId, 160)) violations.push("envelopeId:invalid");
  if (!isNonEmptyString(value.originInstallationId, 160)) violations.push("originInstallationId:invalid");
  if (!(DEMAND_DISPOSITIONS as readonly unknown[]).includes(value.decision)) violations.push("decision:unsupported");
  if (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 1_000)) violations.push("message:invalid");
  if (value.releaseApplicability !== undefined) {
    if (!isRecord(value.releaseApplicability)
      || !isNonEmptyString(value.releaseApplicability.applicability, 1_000)
      || (value.releaseApplicability.releaseRef !== undefined && !isNonEmptyString(value.releaseApplicability.releaseRef, 200))) {
      violations.push("releaseApplicability:invalid");
    }
  }
  if (!isIsoTimestamp(value.createdAt)) violations.push("createdAt:invalid");
  if (typeof value.payloadDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.payloadDigest)) {
    violations.push("payloadDigest:invalid");
  } else if (computeDemandDispositionDigest(value as unknown as DemandDispositionNoticeV1) !== value.payloadDigest) {
    violations.push("payloadDigest:mismatch");
  }
  return violations;
}

export function validateDemandResponseV1(value: unknown): string[] {
  if (!isRecord(value)) return ["response:invalid"];
  const violations: string[] = [];
  // Reject only source-local leak fields; tolerate other unknown/additive fields
  // (forward-compat rolling upgrades). See FORBIDDEN_FEDERATION_FIELDS.
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FEDERATION_FIELDS.has(key)) violations.push(`field:not-allowed:${key}`);
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
  if (value.weight !== undefined) {
    if (value.responseKind !== "interest") violations.push("weight:not-applicable");
    else if (
      typeof value.weight !== "number"
      || !Number.isInteger(value.weight)
      // 1 is the absent canonical form; writing it would change the digest of an
      // otherwise identical response.
      || value.weight < 2
      || value.weight > DEMAND_RESPONSE_MAX_WEIGHT
    ) violations.push("weight:invalid");
  }
  if (!(DEMAND_ATTRIBUTIONS as readonly unknown[]).includes(value.responderAttribution)) {
    violations.push("responderAttribution:unsupported");
  }
  if (value.workClaim !== undefined) {
    violations.push(...validateWorkClaimRequestV1(value.workClaim));
    if (value.responseKind !== "help-offer") violations.push("workClaim:requires-help-offer");
    if (isRecord(value.workClaim) && (value.originRecordRef !== value.workClaim.itemId
      || value.envelopeId !== workClaimEnvelopeId(String(value.workClaim.itemId)))) {
      violations.push("workClaim:subject-mismatch");
    }
    // A claim request is decided on its own body, so its digest is checked
    // against that body rather than trusted.
    if (typeof value.payloadDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(value.payloadDigest)
      && value.payloadDigest !== computeDemandResponseDigest(value as unknown as DemandResponseV1)) {
      violations.push("payloadDigest:mismatch");
    }
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
  // Reject only source-local leak fields (minimization double-check); tolerate any
  // other unknown/additive field so a newer peer doesn't 422 an older receiver during
  // a rolling upgrade (e.g. versionVector). See FORBIDDEN_FEDERATION_FIELDS.
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FEDERATION_FIELDS.has(key)) violations.push(`field:not-allowed:${key}`);
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
  if (value.versionVector !== undefined) {
    if (!isRecord(value.versionVector)) {
      violations.push("versionVector:invalid");
    } else {
      for (const [installationId, counter] of Object.entries(value.versionVector)) {
        if (
          installationId.length === 0 ||
          installationId.length > 160 ||
          typeof counter !== "number" ||
          !Number.isSafeInteger(counter) ||
          counter < 0
        ) {
          violations.push("versionVector:invalid");
          break;
        }
      }
    }
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
