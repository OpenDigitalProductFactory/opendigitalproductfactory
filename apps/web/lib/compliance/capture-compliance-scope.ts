// Canonical "operator confirmed what the business does with data / where it
// employs people → BusinessContext" capture (BI-0B867B67 phase 3).
//
// The conversational twin of the /storefront/settings/business form: both write
// the SAME columns (BusinessContext.dataHandling / employsIn) that the
// applicability engine reads to decide which regulations apply. The compliance
// coworker calls this mid-conversation via the record_compliance_scope MCP tool.
//
// UNION-MERGE, never clobber: a partial conversational capture ("yes, we send
// marketing") adds to whatever the operator already declared on the form; it
// does not wipe the rest. The form's explicit Save remains last-write-wins on
// operator intent. complianceScopeCapturedAt is the freshness marker for both.

import { prisma } from "@dpf/db";
import { isDataHandlingPredicate } from "@dpf/db/regulation-applicability";

const ALLOWED_JURISDICTIONS = new Set(["us", "eu", "uk", "global"]);

export type CaptureComplianceScopeInput = {
  /** Data-handling predicates the org confirmed it does (DATA_HANDLING_PREDICATES). */
  dataHandling?: string[];
  /** Jurisdiction bloc slugs where the org employs staff (drives HR/employment scope). */
  employsIn?: string[];
};

export type CaptureComplianceScopeResult = {
  ok: boolean;
  message: string;
  dataHandling: string[];
  employsIn: string[];
};

function sanitize(values: unknown, allow: (v: string) => boolean): string[] {
  return Array.isArray(values)
    ? [...new Set(values.filter((v): v is string => typeof v === "string" && allow(v)))]
    : [];
}

/**
 * Merge newly-confirmed data-handling predicates and/or employing jurisdictions
 * into the single-install BusinessContext. Returns the resulting sets. Unknown
 * values are dropped (closed-set enforcement); an all-empty call is a no-op that
 * still stamps nothing.
 */
export async function captureComplianceScope(
  input: CaptureComplianceScopeInput,
  db: typeof prisma = prisma,
): Promise<CaptureComplianceScopeResult> {
  const addHandling = sanitize(input.dataHandling, isDataHandlingPredicate);
  const addEmploys = sanitize(input.employsIn, (v) => ALLOWED_JURISDICTIONS.has(v));

  if (addHandling.length === 0 && addEmploys.length === 0) {
    return { ok: false, message: "Nothing to capture — provide dataHandling predicates and/or employsIn jurisdictions.", dataHandling: [], employsIn: [] };
  }

  const existing = await db.businessContext.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, dataHandling: true, employsIn: true },
  });
  if (!existing) {
    return { ok: false, message: "No business context is configured for this install yet — complete company setup first.", dataHandling: [], employsIn: [] };
  }

  const dataHandling = [...new Set([...(existing.dataHandling ?? []).filter(isDataHandlingPredicate), ...addHandling])];
  const employsIn = [...new Set([...(existing.employsIn ?? []), ...addEmploys])];

  await db.businessContext.update({
    where: { id: existing.id },
    data: { dataHandling, employsIn, complianceScopeCapturedAt: new Date() },
  });

  const parts: string[] = [];
  if (addHandling.length > 0) parts.push(`data-handling: ${addHandling.join(", ")}`);
  if (addEmploys.length > 0) parts.push(`employing in: ${addEmploys.join(", ")}`);
  return {
    ok: true,
    message: `Captured ${parts.join("; ")}. Regulations matching these triggers now apply instead of needing review.`,
    dataHandling,
    employsIn,
  };
}
