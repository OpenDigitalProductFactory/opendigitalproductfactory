// apps/web/lib/govern/data/taxonomy.ts
// BI-DG-002 (EP-DATA-GOVERNANCE, spec §6.1): the closed-type vocabulary + precedence
// lattice for the logical data-control spine. This module is PURE — no DB calls, no
// imports that reach a runtime store. Every other govern/data module composes these
// closed unions so classification, lifecycle, MDM, purpose, projection, protection,
// and policy stay independent axes (spec §6.1 design rules).
//
// Vocabularies are grounded in existing substrate, not invented: sensitivity mirrors
// the route/agent taxonomy (`@/lib/tak/agent-sensitivity`), master-data domains reuse
// `@/lib/mdm/domain-registry`, and projection classes match the derived-data payload
// classes in spec §6.4. New members are a reviewed governance change, never ad hoc.

import type { MasterDataDomain } from "@/lib/mdm/domain-registry";
import type { RouteSensitivity } from "@/lib/tak/agent-sensitivity";

// ─── Stable logical identifiers (survive physical renames) ───────────────────

/** Logical asset id, e.g. `data:customer-account`. Stable across table renames. */
export type DataAssetId = `data:${string}`;
/** Logical field id, e.g. `data:customer-account#emailAddress`. */
export type DataFieldId = `${DataAssetId}#${string}`;

const ASSET_ID_RE = /^data:[a-z0-9][a-z0-9-]*$/;
const FIELD_LOCAL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isDataAssetId(value: string): value is DataAssetId {
  return ASSET_ID_RE.test(value);
}

export function makeDataAssetId(slug: string): DataAssetId {
  const id = `data:${slug}`;
  if (!isDataAssetId(id)) {
    throw new Error(`invalid DataAssetId slug: ${JSON.stringify(slug)}`);
  }
  return id as DataAssetId;
}

export function makeDataFieldId(assetId: DataAssetId, localName: string): DataFieldId {
  if (!isDataAssetId(assetId)) {
    throw new Error(`invalid DataAssetId: ${JSON.stringify(assetId)}`);
  }
  if (!FIELD_LOCAL_RE.test(localName)) {
    throw new Error(`invalid field local name: ${JSON.stringify(localName)}`);
  }
  return `${assetId}#${localName}` as DataFieldId;
}

export function isDataFieldId(value: string): value is DataFieldId {
  const hash = value.indexOf("#");
  if (hash < 0) return false;
  const asset = value.slice(0, hash);
  const local = value.slice(hash + 1);
  return isDataAssetId(asset) && FIELD_LOCAL_RE.test(local);
}

/** Split a field id back into its asset id and local field name. */
export function parseDataFieldId(id: DataFieldId): { assetId: DataAssetId; localName: string } {
  const hash = id.indexOf("#");
  return {
    assetId: id.slice(0, hash) as DataAssetId,
    localName: id.slice(hash + 1),
  };
}

// ─── Independent classification axes (spec §6.1) ─────────────────────────────

/** Sensitivity mirrors the existing route/agent taxonomy — one shared anchor. */
export type DataSensitivity = RouteSensitivity; // public | internal | confidential | restricted
export const ALL_DATA_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const satisfies readonly DataSensitivity[];

/** What KIND of data this is — orthogonal to how sensitive it is. */
export type DataCategory =
  | "identity" // names, identifiers that point at a person/org
  | "contact" // email, phone, address
  | "personal-attribute" // demographic/profile facts about a subject
  | "financial" // money, invoices, ledger, tax
  | "credential-secret" // passwords, tokens, keys (encrypted at rest already)
  | "authorization" // roles, grants, capabilities
  | "content" // free-text authored by users/agents (chat, docs, notes)
  | "operational" // business records the platform runs on
  | "configuration" // settings, policy, catalog, reference data
  | "telemetry" // metrics, logs, traces, usage
  | "security-audit" // audit trails, detections, cases
  | "derived-analytic" // embeddings, projections, summaries, scores
  | "system-internal"; // framework/bookkeeping with no subject meaning
export const ALL_DATA_CATEGORIES = [
  "identity",
  "contact",
  "personal-attribute",
  "financial",
  "credential-secret",
  "authorization",
  "content",
  "operational",
  "configuration",
  "telemetry",
  "security-audit",
  "derived-analytic",
  "system-internal",
] as const satisfies readonly DataCategory[];

/** Business criticality — how much its loss/corruption hurts. */
export type DataCriticality = "low" | "standard" | "high" | "mission-critical";
export const ALL_DATA_CRITICALITIES = [
  "low",
  "standard",
  "high",
  "mission-critical",
] as const satisfies readonly DataCriticality[];

/** Master-data domain — reuse the MDM registry's domain vocabulary verbatim. */
export type MasterDataDomainKey = MasterDataDomain;

/**
 * Lifecycle class — a NAMED retention/deletion posture, not an executor. Grounded in
 * the retention engine's category families (audit-log, ai-telemetry, build-log, …)
 * collapsed to governance-meaningful classes. `regulated-record` and
 * `legal-evidence` carry deletion prohibitions that outrank ordinary retention.
 */
export type LifecycleClassKey =
  | "ephemeral" // caches/derived copies rebuildable from source
  | "operational" // ordinary business records, retained while active
  | "telemetry-bounded" // logs/metrics purged past a retention window
  | "business-record" // records kept for a defined business minimum
  | "regulated-record" // financial/tax/HR/consent — deletion maxima constrained
  | "security-audit" // audit trails with a regulated minimum
  | "legal-evidence"; // hold-eligible; deletion blocked while a hold is active
export const ALL_LIFECYCLE_CLASSES = [
  "ephemeral",
  "operational",
  "telemetry-bounded",
  "business-record",
  "regulated-record",
  "security-audit",
  "legal-evidence",
] as const satisfies readonly LifecycleClassKey[];

/**
 * Processing purpose CAPABILITY key — a purpose the platform can technically serve.
 * NOT legal applicability or org authorization (spec §6.1: those come only from
 * confirmed DataProcessingActivity records + executable policy).
 */
export type ProcessingPurposeKey =
  | "service-delivery"
  | "security-and-fraud"
  | "billing-and-payments"
  | "customer-support"
  | "product-analytics"
  | "personalization"
  | "compliance-and-legal"
  | "platform-operations"
  | "coworker-assistance";
export const ALL_PROCESSING_PURPOSES = [
  "service-delivery",
  "security-and-fraud",
  "billing-and-payments",
  "customer-support",
  "product-analytics",
  "personalization",
  "compliance-and-legal",
  "platform-operations",
  "coworker-assistance",
] as const satisfies readonly ProcessingPurposeKey[];

/** Data-residency posture for the asset. */
export type ResidencyClassKey = "local-only" | "region-bound" | "unrestricted";
export const ALL_RESIDENCY_CLASSES = [
  "local-only",
  "region-bound",
  "unrestricted",
] as const satisfies readonly ResidencyClassKey[];

/**
 * Projection payload class — how much of the asset a derived copy may carry.
 * Matches the derived-data contract payload classes in spec §6.4 and the
 * `payloadClass` recorded by the BI-DG-001 semantic-memory gate.
 */
export type ProjectionClass = "structure" | "metadata" | "masked-content" | "content";
export const ALL_PROJECTION_CLASSES = [
  "structure",
  "metadata",
  "masked-content",
  "content",
] as const satisfies readonly ProjectionClass[];

/** Protection already applied before a projection reaches its destination. */
export type DataProtectionTransformation = "none" | "masked" | "tokenized";
export const ALL_DATA_PROTECTION_TRANSFORMATIONS = [
  "none",
  "masked",
  "tokenized",
] as const satisfies readonly DataProtectionTransformation[];

/** Protection profile key — a named encryption/tokenization/masking treatment. */
export type ProtectionProfileKey =
  | "none"
  | "mask-on-read"
  | "tokenize"
  | "encrypt-at-rest"
  | "encrypt-and-mask";
export const ALL_PROTECTION_PROFILES = [
  "none",
  "mask-on-read",
  "tokenize",
  "encrypt-at-rest",
  "encrypt-and-mask",
] as const satisfies readonly ProtectionProfileKey[];

// ─── Subject location (plural, executable) ───────────────────────────────────

/** The role a data subject plays relative to an asset. */
export type SubjectRole =
  | "account"
  | "contact"
  | "employee"
  | "user"
  | "supplier"
  | "organization";
export const ALL_SUBJECT_ROLES = [
  "account",
  "contact",
  "employee",
  "user",
  "supplier",
  "organization",
] as const satisfies readonly SubjectRole[];

/**
 * An executable path from an asset row to a data subject. Plural per asset: a row can
 * relate to a subject through several paths (spec §6.1). `fieldPath` is a dotted
 * relation path (e.g. "account", "thread.user") resolvable against the physical model.
 */
export type SubjectLocator = {
  role: SubjectRole;
  fieldPath: string;
};

// ─── Provenance of a classification decision ─────────────────────────────────

/** Where a classification came from and its confidence state (spec §6.1). */
export type ClassificationProvenance = {
  source: "manual" | "inferred" | "propagated";
  state: "suggested" | "confirmed";
  /** Who/what asserted it: a steward role, a rule id, or a propagation source id. */
  assertedBy: string;
  effectiveFrom: string;
  note?: string;
};

// ─── Policy vocabulary (spec §6.5 — used by policy-decision/enforcement) ──────

/** Governed action kinds a PDP evaluates. */
export type DataAction =
  | "collect"
  | "read"
  | "write"
  | "project"
  | "export"
  | "delete"
  | "anonymize"
  | "publish";
export const ALL_DATA_ACTIONS = [
  "collect",
  "read",
  "write",
  "project",
  "export",
  "delete",
  "anonymize",
  "publish",
] as const satisfies readonly DataAction[];

/** Destination class for a projection/export decision. */
export type DestinationClass =
  | "in-process"
  | "internal-store"
  | "derived-index"
  | "external-service"
  | "backup-archive";
export const ALL_DESTINATION_CLASSES = [
  "in-process",
  "internal-store",
  "derived-index",
  "external-service",
  "backup-archive",
] as const satisfies readonly DestinationClass[];

/** The enforcement point kind that asked for a decision. */
export type DataPepKind =
  | "api-write"
  | "high-risk-read"
  | "mdm-action"
  | "coworker-context"
  | "inference-dispatch"
  | "projection"
  | "lifecycle";
export const ALL_DATA_PEP_KINDS = [
  "api-write",
  "high-risk-read",
  "mdm-action",
  "coworker-context",
  "inference-dispatch",
  "projection",
  "lifecycle",
] as const satisfies readonly DataPepKind[];

// ─── Precedence lattice (spec §6.5 — non-waivable ordering) ──────────────────

/** A policy decision effect. */
export type DataEffect = "allow" | "allow-with-obligations" | "review" | "deny";

/**
 * Deterministic conflict ranks. Higher rank wins within the same precedence level;
 * deny/review outrank allow so ambiguity never silently becomes allow (spec §6.5).
 * Array order NEVER decides policy — callers compare these ranks.
 */
export const EFFECT_RANK: Readonly<Record<DataEffect, number>> = Object.freeze({
  deny: 3,
  review: 2,
  "allow-with-obligations": 1,
  allow: 0,
});

/**
 * Precedence levels, strongest first. Prohibited storage + active preservation are
 * hard constraints; a conflict between hard constraints yields `review` and no
 * mutation. Mandatory authority is next, then consent/contract, org policy, and an
 * approved exception only where the governing authority permits one (spec §6.5).
 */
export type PrecedenceLevel =
  | "hard-constraint"
  | "mandatory-authority"
  | "consent-contract"
  | "organization-policy"
  | "approved-exception";
export const PRECEDENCE_ORDER = [
  "hard-constraint",
  "mandatory-authority",
  "consent-contract",
  "organization-policy",
  "approved-exception",
] as const satisfies readonly PrecedenceLevel[];

/** Rank of a precedence level (lower index = stronger). */
export function precedenceRank(level: PrecedenceLevel): number {
  return PRECEDENCE_ORDER.indexOf(level);
}
