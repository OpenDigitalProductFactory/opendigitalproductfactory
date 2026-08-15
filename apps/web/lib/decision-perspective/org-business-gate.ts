// Org/WWWD business-decision gate (BI-230C9EF7, EP-8AF1C996).
//
// The org + profession DecisionPerspectiveProfiles are seeded on install (mission
// / how-we-decide / profession corpus) but were DORMANT: resolveProfileMaterialForOrg
// is built + tested yet called by zero decision surfaces. This gate activates them
// so a coworker's business decision is actually governed by the organization's own
// recorded stance (WWWD) -- falling back to platform doctrine only as ADVISORY when
// the org is silent, never letting platform doctrine bind a business call.
//
// It mirrors evaluateBuildStudioPlanAdvancementGate (the WWMD/build gate) but keyed
// on organizationId instead of a build, with no build-phase idempotency and no voice
// dispatch. Pure composition of three already-tested primitives:
// resolveProfileMaterialForOrg -> evaluateDecisionPerspective -> persistDecisionInteraction.
//
// It records every decision (proposed outcome + profile chain + orgProfileSelected) to
// the DecisionInteraction ledger -- the substrate the trust-graduation dial reads to
// measure agreement before any autonomy is released. Fail-closed: any resolver/evaluator
// error escalates to a human and is still recorded.

import { createHash } from "crypto";
import { evaluatePerspectiveGate } from "./evaluator";
import type { DecisionGateCaller } from "./evaluator";
import { resolveProfileMaterialForOrg } from "./material";
import type {
  DecisionDomainClass,
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionRiskTier,
  DecisionEvidenceItem,
  DecisionScoredOption,
} from "./types";
import type { AlignmentCorpora, AlignmentEvidence } from "./alignment-criteria";

type OrgBusinessGateClient = any;
type GateEvaluator = (input: DecisionPerspectiveEvaluationInput) => DecisionPerspectiveEvaluationResult;

export function alignmentPolicyVersion(corpora: AlignmentCorpora | undefined): string {
  const canonical = Object.entries(corpora ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([corpus, rows]) => [
      corpus,
      [...(rows ?? [])]
        .map((row) => ({ ref: row.ref, text: row.text }))
        .sort((left, right) => left.ref.localeCompare(right.ref)),
    ]);
  return `wwwd:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 24)}`;
}

function evidence(refPrefix: string, rows: Array<Record<string, unknown>>): AlignmentEvidence[] {
  return rows.map((row, index) => {
    const revisions = Array.isArray(row["revisions"]) ? row["revisions"] as Array<Record<string, unknown>> : [];
    const version = typeof revisions[0]?.["version"] === "number" ? `@v${revisions[0]["version"]}` : "";
    return {
      ref: `${refPrefix}:${String(row["slug"] ?? row["productId"] ?? row["id"] ?? index)}${version}`,
      text: [row["title"], row["name"], row["body"], row["description"]]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join("\n"),
    };
  }).filter((item) => item.text.length > 0);
}

/** Load the three existing org-owned corpora without creating a parallel store. */
export async function loadOrgAlignmentCorpora(
  db: any,
  organizationId: string,
): Promise<AlignmentCorpora | undefined> {
  if (!db.wikiPage?.findMany) return undefined;
  try {
    const wikiRows = await db.wikiPage.findMany({
      where: { organizationId, status: "published", pageKind: { in: ["stance", "principle"] } },
      select: {
        id: true, slug: true, title: true, body: true,
        revisions: { orderBy: { version: "desc" }, take: 1, select: { version: true } },
      },
    }) as Array<Record<string, unknown>>;
    // Product is the organization-owned business portfolio. DigitalProduct is
    // the install-global architecture catalog and must not enter a tenant's
    // WWWD policy evaluation without an organization ownership relation.
    const productRows = db.product?.findMany
      ? await db.product.findMany({
          where: { organizationId, effectiveTo: null },
          select: { id: true, productId: true, name: true, description: true },
        }) as Array<Record<string, unknown>>
      : [];
    const gtmRows = wikiRows.filter((row) =>
      /how-we-decide|supply-chain|pricing|growth|who-we-serve/.test(String(row["slug"] ?? "")),
    );
    return {
      wwwd: evidence("wiki", wikiRows),
      portfolio: evidence("product", productRows),
      gtm: evidence("wiki", gtmRows),
    };
  } catch {
    return undefined;
  }
}

export type OrgBusinessDecisionGateResult = {
  /** True only when the org's own stance recommends/arbitrates the call. */
  allowed: boolean;
  interactionId: string;
  evaluation: DecisionPerspectiveEvaluationResult;
  operatorMessage: string;
  /** True when the organization's OWN profile (not a platform fallback) decided. */
  orgProfileSelected: boolean;
  alignmentPolicyVersion: string;
  amendmentLineage: string[];
};

/**
 * Govern an organization business decision through its WWWD profile (with platform
 * fallback as advisory). Returns the evaluation, an operator message, and whether the
 * org's own profile decided. Always records a DecisionInteraction.
 */
export async function evaluateOrgBusinessDecisionGate(input: {
  db: OrgBusinessGateClient;
  organizationId: string | null | undefined;
  question: string;
  options: string[];
  /**
   * Optional per-option feature vectors (index-aligned to `options`). When
   * present, the gate scores them against kernel commandments and records a
   * real `recommendedOptionId`; when absent, only the coverage-based verdict is
   * recorded (BI-6DCF772F).
   */
  scoredOptions?: DecisionScoredOption[];
  domainClass: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  /** Where the decision originated, e.g. "/coworker-business". Recorded on the ledger. */
  routeContext: string;
  phaseFrom?: string | null;
  phaseTo?: string | null;
  evidence?: DecisionEvidenceItem[];
  fallbackProfileId?: string;
  triggeredByUserId?: string | null;
  taskRunId?: string | null;
  caller?: DecisionGateCaller;
  evaluator?: GateEvaluator;
  resolver?: typeof resolveProfileMaterialForOrg;
  now?: Date;
  recentOverrideCount?: number;
  alignmentCorpora?: AlignmentCorpora;
}): Promise<OrgBusinessDecisionGateResult> {
  const alignmentCorpora = input.alignmentCorpora
    ?? (input.organizationId
      ? await loadOrgAlignmentCorpora(input.db, input.organizationId)
      : undefined);
  const result = await evaluatePerspectiveGate({
    db: input.db,
    organizationId: input.organizationId ?? null,
    fallbackProfileId: input.fallbackProfileId,
    question: input.question,
    options: input.options,
    scoredOptions: input.scoredOptions,
    domainClass: input.domainClass,
    riskTier: input.riskTier,
    routeContext: input.routeContext,
    phaseFrom: input.phaseFrom,
    phaseTo: input.phaseTo,
    evidence: input.evidence,
    triggeredByUserId: input.triggeredByUserId,
    taskRunId: input.taskRunId,
    caller: input.caller,
    evaluator: input.evaluator,
    resolver: input.resolver,
    now: input.now,
    recentOverrideCount: input.recentOverrideCount,
    alignmentCorpora,
  });

  return {
    allowed: result.allowed,
    interactionId: result.interactionId,
    evaluation: result.evaluation,
    operatorMessage: result.operatorMessage,
    orgProfileSelected: result.orgProfileSelected,
    alignmentPolicyVersion: alignmentPolicyVersion(alignmentCorpora),
    amendmentLineage: Array.from(new Set(
      Object.values(alignmentCorpora ?? {}).flatMap((rows) => (rows ?? []).map((row) => row.ref)),
    )).sort(),
  };
}
