// EP-1FABA22D / BI-FF8A57EF — same-organization work sync contract.
//
// Spec 2026-08-23 (zero-touch organization federation) §5.2 makes backlog
// items and epics federated record types so the work a development companion
// produces survives its teardown, and so a companion sees the production
// backlog it is meant to evolve. This module is the wire contract for that
// exchange: a share-safe page of one installation's backlog, pulled by a
// trusted same-organization peer and materialised there as read-only rows.
//
// Pull, not push. A development install must converge on production's truth
// regardless of the production side's outbox health; the observed failure this
// design answers was five days of healthy outbound demand with zero inbound
// rows, a state a push lane cannot report from the receiving side.
//
// Pure and dependency-free: validation and marker helpers only. Persistence
// lives in apps/web/lib/federation/work-sync.ts and the /api/v1/federation/work
// route.

export const FEDERATED_WORK_SPEC_VERSION = "dpf.work-sync/1" as const;

/** Sensitivity tiers that never cross an installation boundary, even inside one
 *  organization. Mirrors SAME_ORG_LOCAL_ONLY_SENSITIVITIES for demand. */
export const FEDERATED_WORK_LOCAL_ONLY_SENSITIVITIES = ["confidential", "restricted"] as const;

/** Default and ceiling for one page of items. A LAN pull of a few hundred rows
 *  is cheap; the ceiling keeps a misbehaving peer from handing back megabytes. */
export const FEDERATED_WORK_PAGE_SIZE = 200;
export const FEDERATED_WORK_MAX_PAGE_SIZE = 500;

export interface FederatedWorkEpicV1 {
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  priority: number | null;
  investmentBucket: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** The active-deferral projection an origin publishes with a `deferred` item
 *  (BI-9DA5F179). A deferral with no reason, trigger or review date is not a
 *  park — it is an item that has vanished — so a mirror never writes `deferred`
 *  bare. The origin's owner principal is install-local and does not travel; the
 *  receiving side holds the mirror's deferral through the link's federated-peer
 *  Principal, because only the origin may change it. */
export interface FederatedWorkDeferralV1 {
  reason: string;
  trigger: string;
  reviewAt: string;
  deferredAt: string | null;
}

export interface FederatedWorkItemV1 {
  itemId: string;
  title: string;
  status: string;
  /** Present when `status` is `deferred` AND the origin holds an attributable
   *  deferral; null otherwise (including an origin that parked the item with
   *  nothing attached — the receiver reports that, it does not hide it). Absent
   *  on pages from a peer older than this field. */
  deferral?: FederatedWorkDeferralV1 | null;
  type: string;
  body: string | null;
  priority: number | null;
  workType: string | null;
  triageOutcome: string | null;
  effortSize: string | null;
  proposedOutcome: string | null;
  resolution: string | null;
  sensitivity: string;
  /** Semantic epic id (EP-*) at the origin, or null. */
  epicId: string | null;
  source: string | null;
  occurrenceCount: number;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  lifecycleTags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface FederatedWorkPageV1 {
  specVersion: typeof FEDERATED_WORK_SPEC_VERSION;
  originInstallationId: string;
  generatedAt: string;
  items: FederatedWorkItemV1[];
  /** Epics travel on the first page only (the set is small); later pages carry []. */
  epics: FederatedWorkEpicV1[];
  /** Opaque cursor for the next page, or null when `complete`. */
  cursor: string | null;
  complete: boolean;
}

const ORIGIN_MARKER_KIND = "federatedWork";
const ORIGIN_MARKER_LINE = /^\[origin:federatedWork:[^\]\r\n]+\]$/;
const ORIGIN_MARKER_PREFIX = "[origin:federatedWork:";

/** The governed marker a mirrored row carries as its own last body line. It is
 *  what keeps a mirror from being re-projected (as work or as demand) by the
 *  install that holds the copy. */
export function federatedWorkOriginMarker(originInstallationId: string, recordId: string): string {
  return `[origin:${ORIGIN_MARKER_KIND}:${originInstallationId}:${recordId}]`;
}

/** SQL-usable prefix for `NOT { body: { contains } }` exclusions. */
export const FEDERATED_WORK_ORIGIN_MARKER_PREFIX = ORIGIN_MARKER_PREFIX;

export function hasFederatedWorkOriginMarker(text: string | null | undefined): boolean {
  return (text ?? "").split(/\r?\n/).some((line) => ORIGIN_MARKER_LINE.test(line.trim()));
}

/** Parse `{ originInstallationId, recordId }` out of a mirrored row, or null. */
export function parseFederatedWorkOriginMarker(
  text: string | null | undefined,
): { originInstallationId: string; recordId: string } | null {
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!ORIGIN_MARKER_LINE.test(line)) continue;
    const inner = line.slice(ORIGIN_MARKER_PREFIX.length, -1);
    const separator = inner.indexOf(":");
    if (separator <= 0 || separator === inner.length - 1) return null;
    return { originInstallationId: inner.slice(0, separator), recordId: inner.slice(separator + 1) };
  }
  return null;
}

/** Body as stored on a mirror: the origin's text plus the marker as a standalone
 *  final line. Idempotent — an already-marked body is not marked twice. */
export function withFederatedWorkOriginMarker(
  body: string | null | undefined,
  originInstallationId: string,
  recordId: string,
): string {
  const marker = federatedWorkOriginMarker(originInstallationId, recordId);
  const trimmed = (body ?? "")
    .split(/\r?\n/)
    .filter((line) => !ORIGIN_MARKER_LINE.test(line.trim()))
    .join("\n")
    .trim();
  return trimmed ? `${trimmed}\n\n${marker}` : marker;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value: unknown, max = 100_000): boolean {
  return typeof value === "string" && value.length <= max;
}
function isNonEmptyString(value: unknown, max = 4_000): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function isNullableString(value: unknown, max = 100_000): boolean {
  return value === null || value === undefined || isString(value, max);
}
function isNullableInt(value: unknown): boolean {
  return value === null || value === undefined || (Number.isInteger(value) && Math.abs(value as number) < 1e9);
}
function isIso(value: unknown): boolean {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}
function isNullableIso(value: unknown): boolean {
  return value === null || value === undefined || isIso(value);
}
function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length <= 200);
}

const SEMANTIC_ID = /^[A-Z]{2,4}-[A-Za-z0-9-]{1,120}$/;

export function validateFederatedWorkEpicV1(value: unknown, path = "epic"): string[] {
  if (!isRecord(value)) return [`${path}:not-an-object`];
  const violations: string[] = [];
  if (!isNonEmptyString(value.epicId, 160) || !SEMANTIC_ID.test(value.epicId as string)) violations.push(`${path}.epicId:invalid`);
  if (!isNonEmptyString(value.title, 20_000)) violations.push(`${path}.title:invalid`);
  if (!isNullableString(value.description)) violations.push(`${path}.description:invalid`);
  if (!isNonEmptyString(value.status, 40)) violations.push(`${path}.status:invalid`);
  if (!isNullableInt(value.priority)) violations.push(`${path}.priority:invalid`);
  if (!isNullableString(value.investmentBucket, 40)) violations.push(`${path}.investmentBucket:invalid`);
  if (!isIso(value.createdAt)) violations.push(`${path}.createdAt:invalid`);
  if (!isIso(value.updatedAt)) violations.push(`${path}.updatedAt:invalid`);
  if (!isNullableIso(value.completedAt)) violations.push(`${path}.completedAt:invalid`);
  return violations;
}

export function validateFederatedWorkItemV1(value: unknown, path = "item"): string[] {
  if (!isRecord(value)) return [`${path}:not-an-object`];
  const violations: string[] = [];
  if (!isNonEmptyString(value.itemId, 160) || !SEMANTIC_ID.test(value.itemId as string)) violations.push(`${path}.itemId:invalid`);
  if (!isNonEmptyString(value.title, 20_000)) violations.push(`${path}.title:invalid`);
  if (!isNonEmptyString(value.status, 40)) violations.push(`${path}.status:invalid`);
  if (!isNonEmptyString(value.type, 40)) violations.push(`${path}.type:invalid`);
  if (!isNullableString(value.body)) violations.push(`${path}.body:invalid`);
  if (!isNullableInt(value.priority)) violations.push(`${path}.priority:invalid`);
  // Closed-vocabulary facets stay short. `proposedOutcome` and `resolution` are
  // prose an operator or coworker typed — the first live pull from production
  // was refused on an item whose proposedOutcome ran past an 80-character cap.
  // Free-form at the wire: what a column can hold, the page can carry. Only
  // shape and ids are enforced here; the receiver writes through Prisma, which
  // owns the column types. (The first live pull was refused on a hand-typed cap.)
  for (const key of ["workType", "triageOutcome", "effortSize", "source", "scopeKind"] as const) {
    if (!isNullableString(value[key])) violations.push(`${path}.${key}:invalid`);
  }
  if (!isNullableString(value.proposedOutcome)) violations.push(`${path}.proposedOutcome:invalid`);
  if (!isNullableString(value.resolution)) violations.push(`${path}.resolution:invalid`);
  if (!isNonEmptyString(value.sensitivity, 40)) violations.push(`${path}.sensitivity:invalid`);
  else if ((FEDERATED_WORK_LOCAL_ONLY_SENSITIVITIES as readonly string[]).includes(value.sensitivity as string)) {
    violations.push(`${path}.sensitivity:local-only`);
  }
  if (value.epicId !== null && value.epicId !== undefined && (!isNonEmptyString(value.epicId, 160) || !SEMANTIC_ID.test(value.epicId as string))) {
    violations.push(`${path}.epicId:invalid`);
  }
  if (!Number.isInteger(value.occurrenceCount) || (value.occurrenceCount as number) < 0) violations.push(`${path}.occurrenceCount:invalid`);
  for (const key of ["archetypeCategories", "archetypeIds", "lifecycleTags"] as const) {
    if (!isStringArray(value[key])) violations.push(`${path}.${key}:invalid`);
  }
  if (!isIso(value.createdAt)) violations.push(`${path}.createdAt:invalid`);
  if (!isIso(value.updatedAt)) violations.push(`${path}.updatedAt:invalid`);
  if (!isNullableIso(value.completedAt)) violations.push(`${path}.completedAt:invalid`);
  violations.push(...validateFederatedWorkDeferralV1(value.deferral, `${path}.deferral`));
  return violations;
}

/** Absent or null is well-formed (an older peer, or an item that is not parked).
 *  Present means every field the deferral contract requires must be there. */
export function validateFederatedWorkDeferralV1(value: unknown, path = "deferral"): string[] {
  if (value === null || value === undefined) return [];
  if (!isRecord(value)) return [`${path}:not-an-object`];
  const violations: string[] = [];
  if (!isNonEmptyString(value.reason, 2_000)) violations.push(`${path}.reason:invalid`);
  if (!isNonEmptyString(value.trigger, 2_000)) violations.push(`${path}.trigger:invalid`);
  if (!isIso(value.reviewAt)) violations.push(`${path}.reviewAt:invalid`);
  if (!isNullableIso(value.deferredAt)) violations.push(`${path}.deferredAt:invalid`);
  return violations;
}

/** Total: never throws. An empty array means the page is well-formed. */
export function validateFederatedWorkPageV1(value: unknown): string[] {
  if (!isRecord(value)) return ["page:not-an-object"];
  const violations: string[] = [];
  if (value.specVersion !== FEDERATED_WORK_SPEC_VERSION) violations.push("specVersion:unsupported");
  if (!/^inst_[a-f0-9]{32}$/.test(String(value.originInstallationId ?? ""))) violations.push("originInstallationId:invalid");
  if (!isIso(value.generatedAt)) violations.push("generatedAt:invalid");
  if (!Array.isArray(value.items)) violations.push("items:not-an-array");
  else if (value.items.length > FEDERATED_WORK_MAX_PAGE_SIZE) violations.push("items:too-many");
  else value.items.forEach((item, index) => violations.push(...validateFederatedWorkItemV1(item, `items[${index}]`)));
  if (!Array.isArray(value.epics)) violations.push("epics:not-an-array");
  else value.epics.forEach((epic, index) => violations.push(...validateFederatedWorkEpicV1(epic, `epics[${index}]`)));
  if (value.cursor !== null && !isNonEmptyString(value.cursor, 200)) violations.push("cursor:invalid");
  if (typeof value.complete !== "boolean") violations.push("complete:invalid");
  if (value.complete === false && value.cursor === null) violations.push("cursor:required-when-incomplete");
  return violations;
}
