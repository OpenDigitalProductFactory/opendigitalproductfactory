// Incumbent application intake core (D2 P1, BI-BF12C25C).
//
// Plan: docs/superpowers/plans/2026-07-24-incumbent-application-intake.md §4 P1.
// Design: docs/superpowers/specs/2026-07-23-incumbent-application-coverage-design.md §5.1, §5.3.
//
// An incumbent application is NOT a new model (kernel DI-B4B65B293024) — it is a
// DigitalProduct in the for_employees portfolio carrying coverageStatus="incumbent"
// and sourceKind="incumbent_intake" (the closed D0 enums). This module is the pure,
// injectable write core: resolve/create the Supplier (the existing AP rail, spec
// §5.3), then create-or-match the DigitalProduct. The thin "use server" wrapper in
// lib/actions/incumbent-intake.ts adds the auth guard and calls this.
//
// Two load-bearing rules, both from the spec:
//   - The row must NOT claim observationConfig.projectedBy. That marker means
//     "owned by a portfolio-source projector, safe to overwrite on re-projection"
//     (see project-portfolio-source.ts). An authored incumbent is durable; claiming
//     it would let a projector re-run clobber the customer's record.
//   - Cost is DECLARED, not derived (spec R5). It is a figure the owner typed; the
//     real SoftwareEntitlement/SupplierContract binding is D7 (Phase C-gated). The
//     row labels costBasis="declared" so no surface can present it as derived.

import type {
  PortfolioCoverageStatus,
  PortfolioSourceKind,
  PrismaClient,
} from "@dpf/db";

// `satisfies` is a COMPILE-TIME drift guard: if a rename in the closed D0 enums
// (portfolio-sources/types.ts) drops these values, tsc fails here. It is
// type-only (erased at runtime), so the core pulls in NO value from @dpf/db and
// stays importable in the source-only worktree — a runtime predicate import
// would drag in the Prisma client and break the unit test / browser graph.
export const INCUMBENT_COVERAGE_STATUS = "incumbent" satisfies PortfolioCoverageStatus;
export const INCUMBENT_SOURCE_KIND = "incumbent_intake" satisfies PortfolioSourceKind;
const FOR_EMPLOYEES_SLUG = "for_employees";

export interface IncumbentIntakeInput {
  /** Product name as the owner knows it — "Mindbody", "QuickBooks Online". */
  name: string;
  /** Vendor/supplier; defaults to the product name when omitted. */
  vendor?: string;
  /** Declared annual cost (NOT derived — spec R5). Optional. */
  annualCostDeclared?: number;
  /** Declared seat count. Optional. */
  seatCount?: number;
  /** Resolved catalog identity (Phase A/B pipeline), when known. Optional. */
  catalogIdentityId?: string;
}

export interface IncumbentIntakeResult {
  productId: string;
  /** true when an existing incumbent matched (no duplicate created). */
  matched: boolean;
  supplierId: string | null;
}

/** ReDoS-safe slug (single-pass collapse, no `+` trim) for a stable productId. */
export function incumbentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

/** Stable, deterministic productId so re-intake of the same app matches, not dupes. */
export function incumbentProductId(name: string): string {
  return `DP-incumbent-${incumbentSlug(name)}`;
}

/**
 * Intake a single incumbent application into the Workforce (for_employees)
 * portfolio, idempotent on the derived productId. Returns whether it matched an
 * existing row. `db` is the Prisma client (injected so the core is unit-testable
 * without a live client).
 */
export async function createIncumbentApplication(
  db: PrismaClient,
  input: IncumbentIntakeInput,
): Promise<IncumbentIntakeResult> {
  const name = input.name.trim();
  if (!name) throw new Error("incumbent intake requires a non-empty name");

  const portfolio = await db.portfolio.findFirst({
    where: { slug: FOR_EMPLOYEES_SLUG },
    select: { id: true },
  });
  if (!portfolio) {
    throw new Error(`portfolio "${FOR_EMPLOYEES_SLUG}" not found — install misconfigured`);
  }

  // Supplier match-or-create on the existing AP rail (spec §5.3). Match by name so
  // repeated intakes of apps from the same vendor share one supplier record.
  const supplierName = (input.vendor ?? name).trim();
  let supplierId: string | null = null;
  if (supplierName) {
    const existing = await db.supplier.findFirst({
      where: { name: supplierName },
      select: { id: true, supplierId: true },
    });
    if (existing) {
      supplierId = existing.supplierId;
    } else {
      const created = await db.supplier.create({
        data: { supplierId: `SUP-incumbent-${incumbentSlug(supplierName)}`, name: supplierName },
        select: { supplierId: true },
      });
      supplierId = created.supplierId;
    }
  }

  const productId = incumbentProductId(name);
  // NOTE: deliberately NO projectedBy marker — this is an authored, durable record,
  // not a projector-owned row (see module header).
  const observationConfig: Record<string, unknown> = {
    source: INCUMBENT_SOURCE_KIND,
    vendor: supplierName || null,
    supplierId,
    catalogIdentityId: input.catalogIdentityId ?? null,
    declaredAnnualCost: input.annualCostDeclared ?? null,
    declaredSeatCount: input.seatCount ?? null,
    costBasis: "declared", // spec R5 — never presented as derived
  };

  const shared = {
    name,
    portfolioId: portfolio.id,
    lifecycleStage: "production", // an incumbent is a live, in-use application
    lifecycleStatus: "active",
    coverageStatus: INCUMBENT_COVERAGE_STATUS,
    sourceKind: INCUMBENT_SOURCE_KIND,
    observationConfig,
  };

  const existingProduct = await db.digitalProduct.findUnique({
    where: { productId },
    select: { id: true },
  });
  if (existingProduct) {
    await db.digitalProduct.update({ where: { productId }, data: shared });
    return { productId, matched: true, supplierId };
  }
  await db.digitalProduct.create({ data: { productId, ...shared } });
  return { productId, matched: false, supplierId };
}
