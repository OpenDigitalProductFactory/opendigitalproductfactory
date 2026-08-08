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

// ─── Context-derived eligibility (BI-DC4E526E) ──────────────────────────────
//
// The PRIMARY cross-org gate is the BI's context, not a hand-set flag: demand for
// the DPF PLATFORM ITSELF legitimately flows upstream to the vendor (that IS the
// federated-demand network's purpose), while a customer's OWN business/domain work
// — their internal infrastructure, operations, proprietary product backlog — must
// never auto-leave. Sensitivity is only an override on top of that context.

/** The DigitalProduct id that denotes the DPF platform itself. */
export const PLATFORM_DIGITAL_PRODUCT_ID = "dpf-portal";

export interface DemandShareContext {
  /** BacklogItem.sensitivity (public|internal|confidential|restricted). */
  sensitivity?: unknown;
  /** The item's DigitalProduct productId, if any (dpf-portal ⇒ platform demand). */
  digitalProductId?: string | null;
  /** The item's planning scope (scopeKind="platform" ⇒ platform demand). */
  scopeKind?: string | null;
}

/** True when the item is demand for the DPF platform itself (vs. a customer's own
 *  business domain). Platform demand is what may flow upstream to the vendor. */
export function isPlatformScopedDemand(ctx: DemandShareContext): boolean {
  return ctx.digitalProductId === PLATFORM_DIGITAL_PRODUCT_ID || ctx.scopeKind === "platform";
}

/** Context-derived cross-org eligibility (deny-by-default):
 *   - `confidential` / `restricted` sensitivity is a HARD block, even for platform demand.
 *   - otherwise PLATFORM-scoped demand is eligible (auto-flows upstream to the vendor).
 *   - otherwise (customer-domain) it is denied unless explicitly marked `public`.
 *  So a customer's internal infrastructure BI never leaves by default; a platform
 *  feature/bug BI does; and either can be overridden by an explicit sensitivity. */
export function mayShareDemandCrossOrg(ctx: DemandShareContext): boolean {
  const s = normalizeSensitivity(ctx.sensitivity);
  if (s === "confidential" || s === "restricted") return false;
  if (isPlatformScopedDemand(ctx)) return true;
  return s === "public";
}

/** Operator-facing refusal for a context-gated cross-org share. */
export function assertMayShareDemandCrossOrg(ctx: DemandShareContext): void {
  if (mayShareDemandCrossOrg(ctx)) return;
  const s = normalizeSensitivity(ctx.sensitivity);
  const reason =
    s === "confidential" || s === "restricted"
      ? `it is classified "${s}"`
      : `it is customer-domain demand (not platform demand) and is not marked "public"`;
  throw new Error(
    `This item cannot be shared across an organization boundary: ${reason}. ` +
      `Platform demand flows upstream automatically; customer-domain demand must be marked "public" to share.`,
  );
}
