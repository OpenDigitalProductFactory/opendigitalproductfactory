// W19 vertical clone collapse — dual-read adapters (BI-99C76A90, architecture
// pass 2026-08-16 §3.2-c).
//
// Pure row-level mappings from the legacy clone families
// (BeautyResource*/Hospitality*/ProviderAvailability) onto the unified
// Resource / ResourceAvailability / ResourceCapacityPool /
// ResourceCapacityAllocation family. EXPAND phase: the clones remain
// authoritative; these adapters are (a) the read-side bridge that lets the
// dual-read merge treat clone rows as unified rows, and (b) the exact mapping
// contract the operator-reviewed data migration executes
// (docs/superpowers/plans/2026-08-18-w19-vertical-clone-collapse-data-migration-plan.md).
//
// EmployeeAvailabilityWindow is a DOCUMENTED EXCEPTION, not an adapter: its
// consent/confirmation semantics (confirmationState, supersededById,
// effectiveFrom/To, employee-vs-hr source) belong to the workforce scheduling
// constraint substrate, which the staffing solver — not storefront capacity —
// consumes. See the migration plan doc §"Documented exceptions".
//
// Every mapper is deterministic and side-effect free; unmappable legacy values
// are reported as warnings, never silently coerced.

import type {
  AvailabilityWindowKind,
  CapacityAllocationState,
  RecordLifecycle,
  ResourceDomain,
} from "@dpf/db";

/** `<CloneModel>:<cloneRowId>` — the idempotency/provenance key on every unified row. */
export function cloneSourceRef(model: string, id: string): string {
  return `${model}:${id}`;
}

export interface AdapterResult<T> {
  draft: T;
  /** Legacy values the mapping could not represent losslessly. */
  warnings: string[];
}

// ── Unified draft shapes (structural — align with the Prisma models) ─────────

export interface UnifiedResourceDraft {
  resourceKey: string;
  organizationId: string;
  storefrontId: string | null;
  domain: ResourceDomain;
  kindSlug: string;
  label: string;
  capacity: number;
  capacityUnit: string;
  serviceArea: string | null;
  blockedReason: string | null;
  attributes: unknown;
  subjectRef: string | null;
  sourceRef: string;
  lifecycle: RecordLifecycle;
  lifecycleAt: Date | null;
  lifecycleReason: string | null;
  version: number;
}

export interface UnifiedAvailabilityDraft {
  organizationId: string;
  /** Unified Resource row id the window attaches to (resolved by sourceRef at migration time). */
  resourceId: string;
  windowKind: AvailabilityWindowKind;
  days: number[];
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  date: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  reason: string | null;
  sourceRef: string;
  lifecycle: RecordLifecycle;
  lifecycleAt: Date | null;
  lifecycleReason: string | null;
  version: number;
}

export interface UnifiedPoolDraft {
  poolKey: string;
  organizationId: string;
  storefrontId: string | null;
  domain: ResourceDomain;
  kindSlug: string;
  label: string;
  capacity: number;
  capacityUnit: string;
  intervalMinutes: number | null;
  attributes: unknown;
  sourceRef: string;
  lifecycle: RecordLifecycle;
  lifecycleAt: Date | null;
  lifecycleReason: string | null;
  version: number;
}

export interface UnifiedAllocationDraft {
  organizationId: string;
  storefrontId: string | null;
  domain: ResourceDomain;
  /** Unified Resource / ResourceCapacityPool row ids (resolved by sourceRef at migration time). */
  resourceId: string | null;
  poolId: string | null;
  bookingId: string | null;
  bookingHoldId: string | null;
  demandSlug: string;
  demandRef: string;
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  state: CapacityAllocationState;
  idempotencyKey: string | null;
  releasedAt: Date | null;
  releaseReason: string | null;
  sourceRef: string;
  lifecycle: RecordLifecycle;
  lifecycleAt: Date | null;
  lifecycleReason: string | null;
  version: number;
}

// ── Legacy clone row shapes (structural, repository-style) ───────────────────

export interface CloneResourceRow {
  id: string;
  resourceId: string;
  organizationId: string;
  storefrontId: string;
  kind: string;
  label: string;
  status: string;
  capacity: number;
  capacityUnit: string;
  serviceArea: string | null;
  blockedReason: string | null;
  attributes: unknown;
  version: number;
}

export interface CloneAvailabilityRow {
  id: string;
  organizationId: string;
  kind: string;
  days: number[];
  startTime: string | null;
  endTime: string | null;
  date: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  reason: string | null;
  version: number;
}

export interface ProviderAvailabilityRow {
  id: string;
  providerId: string;
  days: number[];
  startTime: string;
  endTime: string;
  date: Date | null;
  isBlocked: boolean;
  reason: string | null;
}

export interface HospitalityPoolRow {
  id: string;
  poolId: string;
  organizationId: string;
  storefrontId: string;
  kind: string;
  label: string;
  capacity: number;
  capacityUnit: string;
  intervalMinutes: number | null;
  status: string;
  attributes: unknown;
  version: number;
}

export interface CloneAllocationRow {
  id: string;
  allocationId: string;
  organizationId: string;
  storefrontId: string;
  resourceId: string | null;
  poolId?: string | null;
  bookingId: string | null;
  bookingHoldId: string | null;
  demandType: string;
  demandRef: string;
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  lifecycle: string;
  idempotencyKey: string | null;
  releasedAt: Date | null;
  releaseReason: string | null;
  conflictQuarantinedAt?: Date | null;
  version: number;
}

// ── Value mappings ───────────────────────────────────────────────────────────

/** Clone `status` → W20 record lifecycle. Unknown legacy vocab is preserved in lifecycleReason. */
export function mapCloneStatus(status: string): {
  lifecycle: RecordLifecycle;
  lifecycleReason: string | null;
  warning: string | null;
} {
  if (status === "active") return { lifecycle: "active", lifecycleReason: null, warning: null };
  if (status === "retired") return { lifecycle: "retired", lifecycleReason: null, warning: null };
  if (status === "archived") return { lifecycle: "archived", lifecycleReason: null, warning: null };
  return {
    lifecycle: "archived",
    lifecycleReason: `legacy-status:${status}`,
    warning: `unmapped legacy status ${JSON.stringify(status)} recorded as archived + lifecycleReason`,
  };
}

const ALLOCATION_STATES: readonly CapacityAllocationState[] = [
  "reserved",
  "held",
  "confirmed",
  "active",
  "released",
  "quarantined",
];

/** Clone allocation `lifecycle` string → unified state enum, or null when out of vocabulary. */
export function mapAllocationState(value: string): CapacityAllocationState | null {
  return (ALLOCATION_STATES as readonly string[]).includes(value)
    ? (value as CapacityAllocationState)
    : null;
}

// ── Resource adapters ────────────────────────────────────────────────────────

function fromCloneResource(
  model: "BeautyResource" | "HospitalityResource",
  domain: ResourceDomain,
  row: CloneResourceRow,
  subjectRef: string | null,
): AdapterResult<UnifiedResourceDraft> {
  const status = mapCloneStatus(row.status);
  return {
    draft: {
      resourceKey: row.resourceId,
      organizationId: row.organizationId,
      storefrontId: row.storefrontId,
      domain,
      kindSlug: row.kind,
      label: row.label,
      capacity: row.capacity,
      capacityUnit: row.capacityUnit,
      serviceArea: row.serviceArea,
      blockedReason: row.blockedReason,
      attributes: row.attributes,
      subjectRef,
      sourceRef: cloneSourceRef(model, row.id),
      lifecycle: status.lifecycle,
      lifecycleAt: null,
      lifecycleReason: status.lifecycleReason,
      version: row.version,
    },
    warnings: status.warning ? [status.warning] : [],
  };
}

export function fromBeautyResource(row: CloneResourceRow): AdapterResult<UnifiedResourceDraft> {
  return fromCloneResource("BeautyResource", "beauty", row, null);
}

export function fromHospitalityResource(
  row: CloneResourceRow & { legacyServiceProviderId?: string | null },
): AdapterResult<UnifiedResourceDraft> {
  return fromCloneResource(
    "HospitalityResource",
    "hospitality",
    row,
    row.legacyServiceProviderId ? cloneSourceRef("ServiceProvider", row.legacyServiceProviderId) : null,
  );
}

export function fromHospitalityCapacityPool(row: HospitalityPoolRow): AdapterResult<UnifiedPoolDraft> {
  const status = mapCloneStatus(row.status);
  return {
    draft: {
      poolKey: row.poolId,
      organizationId: row.organizationId,
      storefrontId: row.storefrontId,
      domain: "hospitality",
      kindSlug: row.kind,
      label: row.label,
      capacity: row.capacity,
      capacityUnit: row.capacityUnit,
      intervalMinutes: row.intervalMinutes,
      attributes: row.attributes,
      sourceRef: cloneSourceRef("HospitalityCapacityPool", row.id),
      lifecycle: status.lifecycle,
      lifecycleAt: null,
      lifecycleReason: status.lifecycleReason,
      version: row.version,
    },
    warnings: status.warning ? [status.warning] : [],
  };
}

// ── Availability adapters ────────────────────────────────────────────────────

function fromCloneAvailability(
  model: "BeautyResourceAvailability" | "HospitalityResourceAvailability",
  row: CloneAvailabilityRow,
  unifiedResourceId: string,
  timezone: string,
): AdapterResult<UnifiedAvailabilityDraft> {
  const warnings: string[] = [];
  let windowKind: AvailabilityWindowKind;
  if (row.kind === "available") windowKind = "available";
  else if (row.kind === "blocked") windowKind = "blocked";
  else {
    windowKind = "blocked";
    warnings.push(`unmapped legacy window kind ${JSON.stringify(row.kind)} recorded as blocked`);
  }
  return {
    draft: {
      organizationId: row.organizationId,
      resourceId: unifiedResourceId,
      windowKind,
      days: row.days,
      startTime: row.startTime,
      endTime: row.endTime,
      timezone,
      date: row.date,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      reason: row.reason,
      sourceRef: cloneSourceRef(model, row.id),
      lifecycle: "active",
      lifecycleAt: null,
      lifecycleReason: null,
      version: row.version,
    },
    warnings,
  };
}

export function fromBeautyAvailability(
  row: CloneAvailabilityRow,
  opts: { unifiedResourceId: string; timezone: string },
): AdapterResult<UnifiedAvailabilityDraft> {
  return fromCloneAvailability("BeautyResourceAvailability", row, opts.unifiedResourceId, opts.timezone);
}

export function fromHospitalityAvailability(
  row: CloneAvailabilityRow,
  opts: { unifiedResourceId: string; timezone: string },
): AdapterResult<UnifiedAvailabilityDraft> {
  return fromCloneAvailability("HospitalityResourceAvailability", row, opts.unifiedResourceId, opts.timezone);
}

/**
 * ProviderAvailability (human working time on ServiceProvider) maps onto the
 * unified window against a `domain: "provider"` Resource row whose subjectRef
 * names the provider. The provider-backed Resource row itself is minted by the
 * migration (one per ServiceProvider with availability), not by this adapter.
 */
export function fromProviderAvailability(
  row: ProviderAvailabilityRow,
  opts: { unifiedResourceId: string; organizationId: string; timezone: string },
): AdapterResult<UnifiedAvailabilityDraft> {
  return {
    draft: {
      organizationId: opts.organizationId,
      resourceId: opts.unifiedResourceId,
      windowKind: row.isBlocked ? "blocked" : "available",
      days: row.days,
      startTime: row.startTime,
      endTime: row.endTime,
      timezone: opts.timezone,
      date: row.date,
      startsAt: null,
      endsAt: null,
      reason: row.reason,
      sourceRef: cloneSourceRef("ProviderAvailability", row.id),
      lifecycle: "active",
      lifecycleAt: null,
      lifecycleReason: null,
      version: 1,
    },
    warnings: [],
  };
}

// ── Allocation adapters ──────────────────────────────────────────────────────

function fromCloneAllocation(
  model: "BeautyCapacityAllocation" | "HospitalityCapacityAllocation",
  domain: ResourceDomain,
  row: CloneAllocationRow,
  refs: { unifiedResourceId: string | null; unifiedPoolId: string | null },
): AdapterResult<UnifiedAllocationDraft> {
  const warnings: string[] = [];
  let state = mapAllocationState(row.lifecycle);
  if (state === null) {
    state = "quarantined";
    warnings.push(
      `unmapped legacy allocation lifecycle ${JSON.stringify(row.lifecycle)} recorded as quarantined + lifecycleReason`,
    );
  }
  const quarantinedAt = row.conflictQuarantinedAt ?? null;
  return {
    draft: {
      organizationId: row.organizationId,
      storefrontId: row.storefrontId,
      domain,
      resourceId: refs.unifiedResourceId,
      poolId: refs.unifiedPoolId,
      bookingId: row.bookingId,
      bookingHoldId: row.bookingHoldId,
      demandSlug: row.demandType,
      demandRef: row.demandRef,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      quantity: row.quantity,
      state: quarantinedAt ? "quarantined" : state,
      idempotencyKey: row.idempotencyKey,
      releasedAt: row.releasedAt,
      releaseReason: row.releaseReason,
      sourceRef: cloneSourceRef(model, row.id),
      lifecycle: quarantinedAt ? "quarantined" : "active",
      lifecycleAt: quarantinedAt,
      lifecycleReason:
        state === "quarantined" && mapAllocationState(row.lifecycle) === null
          ? `legacy-state:${row.lifecycle}`
          : quarantinedAt
            ? "legacy:conflictQuarantinedAt"
            : null,
      version: row.version,
    },
    warnings,
  };
}

export function fromBeautyAllocation(
  row: CloneAllocationRow,
  opts: { unifiedResourceId: string },
): AdapterResult<UnifiedAllocationDraft> {
  return fromCloneAllocation("BeautyCapacityAllocation", "beauty", row, {
    unifiedResourceId: opts.unifiedResourceId,
    unifiedPoolId: null,
  });
}

export function fromHospitalityAllocation(
  row: CloneAllocationRow,
  opts: { unifiedResourceId: string | null; unifiedPoolId: string | null },
): AdapterResult<UnifiedAllocationDraft> {
  return fromCloneAllocation("HospitalityCapacityAllocation", "hospitality", row, {
    unifiedResourceId: opts.unifiedResourceId,
    unifiedPoolId: opts.unifiedPoolId,
  });
}
