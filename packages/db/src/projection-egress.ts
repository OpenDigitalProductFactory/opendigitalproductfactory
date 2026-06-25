// EP-MSP-FEDERATION · R5 — projection-contract egress enforcement (BI-4F8F50FD
// runtime arm). The B2 projection-serialization library is the *capability*
// (allow-list + forbidden-field guard + negative-egress proof); this is the
// thin layer that APPLIES it to the one payload that actually crosses a link at
// runtime today — the incident push (customer → managing MSP, lib/federation/push).
//
// Why this exists: before R5 the outbound incident was sent raw, so the
// "minimum-necessary, client data never crosses the link" sovereignty claim was
// true only in the (unused) library, not on the wire. R5 makes it true at egress:
// every field that leaves the customer boundary is allow-listed by the link's
// projection contract AND survives the forbidden-field guard, with a hard refusal
// if the projection still contains a violation.
//
// Pure (no prisma): the contract spec is resolved from data the caller already
// holds (link.metadata.proposedProjection), so this stays unit-testable and the
// egress proof is deterministic.

import {
  assertNoExcludedEgress,
  projectEstatePayload,
  type ProjectionContractSpec,
  type RetentionClass,
} from "./projection-serialization";

/** The single slice an incident projection rides in. */
export const INCIDENT_SLICE = "incident";

/**
 * Minimum-necessary default contract for incident egress. Used when a link
 * carries no negotiated projection (the common case until a contract is
 * authored). Allow-lists exactly the fields the federation incident wire +
 * receiver depend on (api/v1/federation/incident) plus the correlation refs —
 * nothing else can leave. retentionClass "short": an incident is operational
 * signal, not a record to hold.
 */
export const DEFAULT_INCIDENT_PROJECTION: ProjectionContractSpec = {
  includeSlices: [INCIDENT_SLICE],
  excludeSlices: [],
  fieldAllowList: {
    [INCIDENT_SLICE]: [
      "incidentKey",
      "summary",
      "highestSeverity",
      "alertCount",
      "payloadHash",
      "baseVersion",
      "edgeNodeId",
      "eventClass",
    ],
  },
  retentionClass: "short",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const RETENTION_CLASSES: ReadonlySet<RetentionClass> = new Set<RetentionClass>([
  "ephemeral",
  "short",
  "standard",
  "compliance-hold",
]);

/**
 * Coerce a stored projection (the inviter's `proposedProjection`, persisted on
 * the link as JSON) into a valid {@link ProjectionContractSpec}. Anything
 * missing, malformed, or empty falls back to {@link DEFAULT_INCIDENT_PROJECTION}
 * — a link must never egress under a broken contract, and "no contract" means
 * minimum-necessary, not "everything".
 */
export function resolveIncidentProjectionSpec(stored: unknown): ProjectionContractSpec {
  if (!isPlainObject(stored)) return DEFAULT_INCIDENT_PROJECTION;
  const includeSlices = Array.isArray(stored.includeSlices)
    ? stored.includeSlices.filter((s): s is string => typeof s === "string")
    : [];
  // An empty/invalid include set is not a licence to send everything.
  if (includeSlices.length === 0) return DEFAULT_INCIDENT_PROJECTION;

  const excludeSlices = Array.isArray(stored.excludeSlices)
    ? stored.excludeSlices.filter((s): s is string => typeof s === "string")
    : [];

  let fieldAllowList: Record<string, string[]> | undefined;
  if (isPlainObject(stored.fieldAllowList)) {
    fieldAllowList = {};
    for (const [slice, fields] of Object.entries(stored.fieldAllowList)) {
      if (Array.isArray(fields)) {
        fieldAllowList[slice] = fields.filter((f): f is string => typeof f === "string");
      }
    }
  }

  const retentionClass =
    typeof stored.retentionClass === "string" && RETENTION_CLASSES.has(stored.retentionClass as RetentionClass)
      ? (stored.retentionClass as RetentionClass)
      : "short";

  return {
    includeSlices,
    excludeSlices,
    ...(fieldAllowList ? { fieldAllowList } : {}),
    retentionClass,
  };
}

export interface IncidentEgressResult {
  /** The minimized, flat payload safe to put on the wire (the `incident` slice, unwrapped). */
  payload: Record<string, unknown>;
  /** Everything the contract withheld — slices, fields, and forbidden-class fields. */
  excluded: { slices: string[]; fields: string[]; forbidden: string[] };
  /** Negative-egress proof. Empty = provably minimum-necessary; non-empty = DO NOT SEND. */
  violations: string[];
}

/**
 * Project a raw incident object for egress under `spec`. The incident is treated
 * as the single `incident` slice, run through the B2 allow-list + forbidden-field
 * guard, then the egress proof is taken over the result. The returned `payload`
 * is the flat (unwrapped) incident the wire expects; callers MUST refuse to send
 * when `violations` is non-empty.
 */
export function projectIncidentForEgress(
  spec: ProjectionContractSpec,
  incident: Record<string, unknown>,
): IncidentEgressResult {
  const { projected, excluded } = projectEstatePayload(spec, { [INCIDENT_SLICE]: incident });
  const violations = assertNoExcludedEgress(spec, projected);
  const payload = isPlainObject(projected[INCIDENT_SLICE])
    ? (projected[INCIDENT_SLICE] as Record<string, unknown>)
    : {};
  return { payload, excluded, violations };
}
