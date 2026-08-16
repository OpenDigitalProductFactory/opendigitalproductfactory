// Independent evidence re-verification for a recorded decision (BI-8192557E
// phase 2b, EP-VERIFICATION-INTEGRITY; spec §2 Axis 4).
//
// Phase 2a made a recorded citation carry its StructuredLocator. This is the
// pass that USES it: load a decision's persisted citations, re-resolve each one
// against live source, and report which no longer hold.
//
// SEPARATION OF DUTIES. This never runs inside `principle_decide`. It is a
// distinct call, made later, with no access to the original scorer's reasoning
// — the property that makes the result mean anything. Verifier identity is an
// audit field, never a gate input (governance-approves-evidence-not-provenance).
//
// FAIL-CLOSED IN BOTH DIRECTIONS — the load-bearing design point. Naively piping
// every source into `reverifyCitations` is wrong, because that function folds
// `unresolved` into `degrade`: correct when the resolver COULD read the cited
// artifact and it was not there (that is fabrication), but catastrophic when the
// resolver cannot reach source at all. A production install has no repo checkout
// (`isDevInstance()` is false), so an unguarded pass would report every decision
// ever made as fabricated evidence. "We could not look" and "we looked and it
// failed" are different findings and are reported as different outcomes here.
//
// Read-only by contract. The decision row is sealed into the append-only hash
// chain, so a verdict cannot be written back onto it; consuming a degrade — and
// re-scoring the affected dimension — is phase 3.

import {
  reverifyCitations,
  type CitationReVerification,
  type LocatorResolver,
} from "@/lib/decision/evidence-reverifier";
import {
  recordedCitationsFromSources,
  type UnverifiableSource,
} from "@/lib/decision/recorded-citations";
import { decisionInteractionRowToEvaluation } from "@/lib/decision-perspective/persistence";

/** Whether this install can read the source a `code`/`spec`/`doc` locator names. */
export type SourceAccess =
  | { available: true; repoRoot: string }
  | { available: false; detail: string };

/**
 * Overall verdict for the citations that COULD be checked.
 *
 * `verified` is deliberately not a claim about the whole decision — read it
 * together with `coverage`. A decision whose only citation confirmed, but which
 * recorded four more with no locator, is `verified` at coverage 1/5, and the
 * caller must be told both numbers.
 */
export type DecisionEvidenceOutcome = "verified" | "degraded" | "unverifiable";

export type UnverifiableCause = "no-source-access" | "no-recorded-locators";

export type DecisionEvidenceReport = {
  interactionId: string;
  question: string | null;
  recordedAt: Date | null;
  outcome: DecisionEvidenceOutcome;
  /** Set only when `outcome` is "unverifiable" — WHY nothing could be checked. */
  unverifiableCause: UnverifiableCause | null;
  coverage: {
    /** Sources on the decision record. */
    recordedSources: number;
    /** Of those, how many carried a re-resolvable locator and were checked. */
    checked: number;
    /** Of those, how many could not be checked at all. */
    unverifiable: number;
    /** True when every recorded source was checkable. */
    complete: boolean;
  };
  confirmed: number;
  degraded: number;
  unresolved: number;
  /** (option, dimension) pairs whose evidence no longer holds. */
  degrade: Array<{ optionId: string; dimensionKey: string }>;
  results: CitationReVerification[];
  unverifiableSources: UnverifiableSource[];
  sourceAccess: { available: boolean; detail: string };
};

export type DecisionEvidenceLookup =
  | { found: false; interactionId: string }
  | { found: true; report: DecisionEvidenceReport };

/** The one row shape this pass needs. Structural so tests need no Prisma. */
export type DecisionInteractionReader = {
  decisionInteraction: {
    findUnique(args: {
      where: { interactionId: string };
      select: Record<string, true>;
    }): Promise<Record<string, unknown> | null>;
  };
};

/**
 * Wrap a repo-backed resolver with the project-file path guard.
 *
 * A cited `filePath` is attacker-influenced data: it arrives from whatever
 * agent made the decision and is echoed back as `liveExcerpt`. The phase-1
 * resolver confines reads to the repo root, but the repo root legitimately
 * CONTAINS `.env`, keys and credential files — so a citation naming one would
 * otherwise round-trip its contents to any caller holding `registry_read`.
 * `isPathAllowedSync` is the same blocklist `read_project_file` enforces;
 * reusing it keeps one home for "what source may be read out of this install".
 *
 * A blocked path fails closed to `unresolved`, exactly like a missing file:
 * unreadable is never evidence of truth.
 */
export function guardResolverPaths(
  resolve: LocatorResolver,
  isPathAllowed: (path: string) => boolean,
): LocatorResolver {
  return async (locator) => {
    const cited =
      locator.sourceType === "code"
        ? locator.filePath
        : locator.sourceType === "spec" || locator.sourceType === "doc"
          ? locator.path
          : null;
    if (cited !== null && !isPathAllowed(cited)) {
      return { resolved: false, liveExcerpt: null };
    }
    return resolve(locator);
  };
}

function emptyReport(
  interactionId: string,
  question: string | null,
  recordedAt: Date | null,
  recordedSources: number,
  unverifiableSources: UnverifiableSource[],
  cause: UnverifiableCause,
  sourceAccess: { available: boolean; detail: string },
): DecisionEvidenceReport {
  return {
    interactionId,
    question,
    recordedAt,
    outcome: "unverifiable",
    unverifiableCause: cause,
    coverage: {
      recordedSources,
      checked: 0,
      unverifiable: unverifiableSources.length,
      complete: recordedSources === 0,
    },
    confirmed: 0,
    degraded: 0,
    unresolved: 0,
    degrade: [],
    results: [],
    unverifiableSources,
    sourceAccess,
  };
}

/**
 * Re-verify one recorded decision's cited evidence.
 *
 * `resolve` is injected rather than constructed here so the pass stays pure and
 * testable and never hard-codes a filesystem dependency — the same contract
 * `evidence-reverifier.ts` set.
 */
export async function reverifyDecisionEvidence(input: {
  db: DecisionInteractionReader;
  interactionId: string;
  sourceAccess: SourceAccess;
  resolve: LocatorResolver;
}): Promise<DecisionEvidenceLookup> {
  const row = await input.db.decisionInteraction.findUnique({
    where: { interactionId: input.interactionId },
    select: {
      interactionId: true,
      profileId: true,
      profileVersionId: true,
      question: true,
      sources: true,
      createdAt: true,
    },
  });
  if (!row) return { found: false, interactionId: input.interactionId };

  const question = typeof row.question === "string" ? row.question : null;
  const recordedAt = row.createdAt instanceof Date ? row.createdAt : null;
  const accessDetail = input.sourceAccess.available
    ? `source readable at ${input.sourceAccess.repoRoot}`
    : input.sourceAccess.detail;
  const access = { available: input.sourceAccess.available, detail: accessDetail };

  // Re-use the audit read path rather than parsing the jsonb here, so the
  // verifier sees exactly what the Decision Canvas sees.
  const evaluation = decisionInteractionRowToEvaluation({
    interactionId: String(row.interactionId ?? input.interactionId),
    profileId: String(row.profileId ?? ""),
    profileVersionId: String(row.profileVersionId ?? ""),
    sources: row.sources,
  });
  const recordedSources = evaluation.sources.length;
  const { citations, unverifiable } = recordedCitationsFromSources(evaluation.sources);

  // Order matters: report the environment limitation BEFORE the evidence
  // verdict. Without source access nothing below is a statement about the
  // citations, and presenting it as one would manufacture a fabrication finding
  // out of a deployment fact.
  if (!input.sourceAccess.available) {
    return {
      found: true,
      report: emptyReport(
        String(row.interactionId ?? input.interactionId),
        question,
        recordedAt,
        recordedSources,
        unverifiable,
        "no-source-access",
        access,
      ),
    };
  }

  if (citations.length === 0) {
    return {
      found: true,
      report: emptyReport(
        String(row.interactionId ?? input.interactionId),
        question,
        recordedAt,
        recordedSources,
        unverifiable,
        "no-recorded-locators",
        access,
      ),
    };
  }

  const report = await reverifyCitations(citations, input.resolve);

  return {
    found: true,
    report: {
      interactionId: String(row.interactionId ?? input.interactionId),
      question,
      recordedAt,
      outcome: report.degrade.length > 0 ? "degraded" : "verified",
      unverifiableCause: null,
      coverage: {
        recordedSources,
        checked: citations.length,
        unverifiable: unverifiable.length,
        complete: unverifiable.length === 0,
      },
      confirmed: report.confirmed,
      degraded: report.degraded,
      unresolved: report.unresolved,
      degrade: report.degrade,
      results: report.results,
      unverifiableSources: unverifiable,
      sourceAccess: access,
    },
  };
}
