// EP-DELIVERY-FLOW · BI-DC4E526E — cross-organization demand-sharing gate.
//
// Same-org federation is trust-by-default. Crossing an ORG boundary (customer →
// reseller → upstream vendor hub) is DENY-BY-DEFAULT: a backlog item may be proprietary
// and not meant for others. Kernel decision DI-3E77E48D5710 (high confidence,
// "least privilege, deny by default") governs this: an item crosses an org
// boundary only if its sensitivity explicitly permits it.
//
// Sensitivity reuses the platform's existing classification vocabulary
// (public | internal | confidential | restricted). Only `public` — the operator's
// explicit "safe to share beyond our organization" mark — is cross-org eligible.
// The DEFAULT is `internal`, so an unclassified item never leaks upstream.
//
// Pure and dependency-free — exhaustively unit-testable. The egress chokepoints
// (channel-demand selection, and any future cross-org auto-projection) call
// assertMayCrossOrgBoundary before an item is projected onto a cross-org link.

export const BACKLOG_SENSITIVITY_VALUES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type BacklogSensitivity = (typeof BACKLOG_SENSITIVITY_VALUES)[number];

/** The safe default for an unclassified item: within-org only. */
export const DEFAULT_BACKLOG_SENSITIVITY: BacklogSensitivity = "internal";

/** The ONLY sensitivity that may cross an organization boundary. */
const CROSS_ORG_ELIGIBLE: ReadonlySet<BacklogSensitivity> = new Set(["public"]);

export function isBacklogSensitivity(value: unknown): value is BacklogSensitivity {
  return (
    typeof value === "string" &&
    (BACKLOG_SENSITIVITY_VALUES as readonly string[]).includes(value)
  );
}

/** Coerce a stored/nullable value to a valid sensitivity, defaulting to the safe
 *  `internal` — an unknown or missing classification is treated as NOT shareable. */
export function normalizeSensitivity(value: unknown): BacklogSensitivity {
  return isBacklogSensitivity(value) ? value : DEFAULT_BACKLOG_SENSITIVITY;
}

/** Deny-by-default: true only when the item is explicitly cleared to leave the org. */
export function mayCrossOrgBoundary(sensitivity: unknown): boolean {
  return CROSS_ORG_ELIGIBLE.has(normalizeSensitivity(sensitivity));
}

/** Throw a clear, operator-facing refusal when an item may not cross an org
 *  boundary. Called at every cross-org egress chokepoint. */
export function assertMayCrossOrgBoundary(sensitivity: unknown): void {
  if (!mayCrossOrgBoundary(sensitivity)) {
    throw new Error(
      `This item's sensitivity ("${normalizeSensitivity(sensitivity)}") does not permit ` +
        `cross-organization sharing. Mark it "public" to share it beyond your organization.`,
    );
  }
}
