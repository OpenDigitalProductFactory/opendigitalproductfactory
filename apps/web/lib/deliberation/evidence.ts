// apps/web/lib/deliberation/evidence.ts
// Task 5 — Retrieval-first evidence contracts (spec §8).
//
// This module is pure policy logic plus a thin mirror helper. It enforces:
//   §8.1 retrieval-first: if a claim CAN be grounded, it MUST be.
//   §8.2 evidence grades A/B/C/D with D barred from final rationale.
//   §8.3 structured source locators — loose URLs are citation theater
//        and are refused loudly.
//   §8.4 admissibility — rejects sourceTypes outside the pattern's
//        admissibleSourceTypes list, rejects when retrievalRequired
//        but no sourceType is cited in a final outcome.
//   §8.5 pattern-level evidence declarations come from the caller
//        (already resolved via ResolvedDeliberationPattern.evidenceRequirements);
//        this module does NOT import the registry — the caller extracts
//        and passes in the raw config.
//   §8.6 insufficient evidence degrades gracefully via
//        `needs-more-evidence` badge, not fabricated consensus.

import { recordExternalEvidence } from "../actions/external-evidence";
import type {
  ClaimEvidenceGrade,
  DeliberationArtifactType,
  EvidenceSourceType,
} from "./types";
import { isEvidenceSourceType } from "./types";

/* -------------------------------------------------------------------------- */
/* Structured locators — spec §8.3                                            */
/* -------------------------------------------------------------------------- */

export type StructuredLocator =
  | { sourceType: "code"; filePath: string; line?: number; commit?: string }
  | { sourceType: "spec"; path: string; heading?: string }
  | { sourceType: "doc"; path: string; heading?: string }
  | {
      sourceType: "paper";
      doi?: string;
      url?: string;
      page?: number;
      section?: string;
    }
  | {
      sourceType: "web";
      url: string;
      title?: string;
      retrievedAt: string;
    }
  | {
      sourceType: "db-query";
      entity: string;
      query: string;
      capturedAt: string;
    }
  | {
      sourceType: "tool-output";
      toolName: string;
      parameterHash: string;
      resultRef: string;
    }
  | {
      sourceType: "runtime-state";
      snapshotKey: string;
      capturedAt: string;
    };

/**
 * Normalize an unknown value into a StructuredLocator.
 *
 * Fails loud on malformed input (console.warn with shape + missing field)
 * per project memory "silent seed skips audit 2026-04-17" and spec §8.4.
 * Refusing loose URLs silently is a citation-theater risk — when a loose
 * URL string is passed, the caller forgot to structure it, and we want
 * the failure visible in logs rather than recorded as "evidence".
 */
export function normalizeLocator(raw: unknown): StructuredLocator | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "string") {
    console.warn(
      "[deliberation/evidence] refusing loose locator string; callers must structure it",
      { received: raw.slice(0, 120) },
    );
    return null;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[deliberation/evidence] locator must be an object", {
      received: typeof raw,
    });
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const sourceType = obj.sourceType;
  if (!isEvidenceSourceType(sourceType)) {
    console.warn("[deliberation/evidence] unknown sourceType on locator", {
      sourceType,
    });
    return null;
  }

  const missing = (field: string) => {
    console.warn(
      "[deliberation/evidence] malformed locator — missing required field",
      { sourceType, missing: field },
    );
    return null;
  };

  switch (sourceType) {
    case "code": {
      if (typeof obj.filePath !== "string" || obj.filePath === "") {
        return missing("filePath");
      }
      const out: StructuredLocator = { sourceType: "code", filePath: obj.filePath };
      if (typeof obj.line === "number" && Number.isFinite(obj.line)) out.line = obj.line;
      if (typeof obj.commit === "string" && obj.commit !== "") out.commit = obj.commit;
      return out;
    }
    case "spec":
    case "doc": {
      if (typeof obj.path !== "string" || obj.path === "") {
        return missing("path");
      }
      const out: StructuredLocator =
        sourceType === "spec"
          ? { sourceType: "spec", path: obj.path }
          : { sourceType: "doc", path: obj.path };
      if (typeof obj.heading === "string" && obj.heading !== "") {
        out.heading = obj.heading;
      }
      return out;
    }
    case "paper": {
      const hasDoi = typeof obj.doi === "string" && obj.doi !== "";
      const hasUrl = typeof obj.url === "string" && obj.url !== "";
      if (!hasDoi && !hasUrl) return missing("doi|url");
      const out: StructuredLocator = { sourceType: "paper" };
      if (hasDoi) out.doi = obj.doi as string;
      if (hasUrl) out.url = obj.url as string;
      if (typeof obj.page === "number" && Number.isFinite(obj.page)) out.page = obj.page;
      if (typeof obj.section === "string" && obj.section !== "") {
        out.section = obj.section;
      }
      return out;
    }
    case "web": {
      if (typeof obj.url !== "string" || obj.url === "") return missing("url");
      if (typeof obj.retrievedAt !== "string" || obj.retrievedAt === "") {
        return missing("retrievedAt");
      }
      const out: StructuredLocator = {
        sourceType: "web",
        url: obj.url,
        retrievedAt: obj.retrievedAt,
      };
      if (typeof obj.title === "string" && obj.title !== "") out.title = obj.title;
      return out;
    }
    case "db-query": {
      if (typeof obj.entity !== "string" || obj.entity === "") return missing("entity");
      if (typeof obj.query !== "string" || obj.query === "") return missing("query");
      if (typeof obj.capturedAt !== "string" || obj.capturedAt === "") {
        return missing("capturedAt");
      }
      return {
        sourceType: "db-query",
        entity: obj.entity,
        query: obj.query,
        capturedAt: obj.capturedAt,
      };
    }
    case "tool-output": {
      if (typeof obj.toolName !== "string" || obj.toolName === "") {
        return missing("toolName");
      }
      if (typeof obj.parameterHash !== "string" || obj.parameterHash === "") {
        return missing("parameterHash");
      }
      if (typeof obj.resultRef !== "string" || obj.resultRef === "") {
        return missing("resultRef");
      }
      return {
        sourceType: "tool-output",
        toolName: obj.toolName,
        parameterHash: obj.parameterHash,
        resultRef: obj.resultRef,
      };
    }
    case "runtime-state": {
      if (typeof obj.snapshotKey !== "string" || obj.snapshotKey === "") {
        return missing("snapshotKey");
      }
      if (typeof obj.capturedAt !== "string" || obj.capturedAt === "") {
        return missing("capturedAt");
      }
      return {
        sourceType: "runtime-state",
        snapshotKey: obj.snapshotKey,
        capturedAt: obj.capturedAt,
      };
    }
    default: {
      // exhaustive — keeps TS honest if new sourceTypes are added.
      const _exhaustive: never = sourceType;
      void _exhaustive;
      return null;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Admissibility — spec §8.2 + §8.4                                           */
/* -------------------------------------------------------------------------- */

/**
 * Source-sensitive artifact types per spec §8.2. For these, final rationale
 * claims must be Grade A or B — Grade C inference is not permitted because
 * the assertion class demands exact grounding (file+line, spec+section,
 * paper+page, URL+timestamp, policy clause, date-sensitive source).
 */
const SOURCE_SENSITIVE_ARTIFACT_TYPES: ReadonlySet<DeliberationArtifactType> =
  new Set<DeliberationArtifactType>([
    "spec",
    "code-change",
    "policy",
    "architecture-decision",
  ]);

export type AdmissibilityCheck = {
  admissible: boolean;
  reason: string;
};

export function checkAdmissibility(params: {
  artifactType: DeliberationArtifactType;
  grade: ClaimEvidenceGrade;
  pattern: {
    retrievalRequired: boolean;
    admissibleSourceTypes: readonly EvidenceSourceType[];
  };
  sourceType?: EvidenceSourceType;
  isFinalRationale: boolean;
}): AdmissibilityCheck {
  const { artifactType, grade, pattern, sourceType, isFinalRationale } = params;

  // §8.2 Grade D is model-memory only — hypothesis to investigate, never
  // final rationale.
  if (isFinalRationale && grade === "D") {
    return {
      admissible: false,
      reason: `grade D is not permitted in final outcome rationale (artifactType=${artifactType}); Grade D is hypothesis-only`,
    };
  }

  // §8.2 source-sensitive artifacts demand Grade A or B in final rationale.
  if (
    isFinalRationale &&
    grade === "C" &&
    SOURCE_SENSITIVE_ARTIFACT_TYPES.has(artifactType)
  ) {
    return {
      admissible: false,
      reason: `grade C inference is not admissible for source-sensitive artifactType=${artifactType}; retrieve an exact source (Grade A) or synthesize cited sources (Grade B)`,
    };
  }

  // §8.4 retrieval-required patterns demand a sourceType when the claim
  // is going into the final outcome.
  if (isFinalRationale && pattern.retrievalRequired && !sourceType) {
    return {
      admissible: false,
      reason:
        "pattern requires retrieval but claim has no sourceType cited; vague-memory arguments are inadmissible",
    };
  }

  // §8.4 admissibleSourceTypes gate — if the claim cites a sourceType, it
  // must match the pattern's allowed set.
  if (sourceType && !pattern.admissibleSourceTypes.includes(sourceType)) {
    return {
      admissible: false,
      reason: `sourceType=${sourceType} is not in the pattern's admissibleSourceTypes [${pattern.admissibleSourceTypes.join(", ")}]`,
    };
  }

  return { admissible: true, reason: "ok" };
}

/* -------------------------------------------------------------------------- */
/* Fact vs. inference split — spec §8.2 synthesis guidance                    */
/* -------------------------------------------------------------------------- */

export type FactVsInferenceSplit = {
  facts: Array<{ claimId: string; grade: "A" | "B" }>;
  inferences: Array<{ claimId: string; grade: "C" | "D" }>;
};

export function splitFactsVsInferences(
  claims: Array<{ claimId: string; grade: ClaimEvidenceGrade }>,
): FactVsInferenceSplit {
  const facts: Array<{ claimId: string; grade: "A" | "B" }> = [];
  const inferences: Array<{ claimId: string; grade: "C" | "D" }> = [];
  for (const c of claims) {
    if (c.grade === "A" || c.grade === "B") {
      facts.push({ claimId: c.claimId, grade: c.grade });
    } else {
      inferences.push({ claimId: c.claimId, grade: c.grade });
    }
  }
  return { facts, inferences };
}

/* -------------------------------------------------------------------------- */
/* Evidence badge — spec §8.6 "degrade gracefully"                            */
/* -------------------------------------------------------------------------- */

export type EvidenceBadge = "source-backed" | "mixed" | "needs-more-evidence";

export function computeEvidenceBadge(
  claims: Array<{ grade: ClaimEvidenceGrade }>,
): EvidenceBadge {
  if (claims.length === 0) return "needs-more-evidence";
  let hasSourceBacked = false;
  let hasInference = false;
  for (const c of claims) {
    if (c.grade === "A" || c.grade === "B") {
      hasSourceBacked = true;
    } else {
      hasInference = true;
    }
  }
  if (hasSourceBacked && !hasInference) return "source-backed";
  if (hasSourceBacked && hasInference) return "mixed";
  return "needs-more-evidence";
}

/* -------------------------------------------------------------------------- */
/* External-evidence mirror — Step 5.4                                        */
/* -------------------------------------------------------------------------- */

/**
 * Mirror a deliberation retrieval event into the existing
 * ExternalEvidenceRecord stream. This is a thin convenience so we can
 * observe deliberation retrieval activity alongside other platform
 * external-evidence records without overloading ExternalEvidenceRecord
 * with deliberation-only columns.
 *
 * The deliberationRunId travels inside `details` so the record keeps a
 * back-reference to the owning DeliberationRun. No new DB columns.
 */
export async function mirrorDeliberationRetrievalEvent(input: {
  actorUserId: string;
  deliberationRunId: string;
  target: string;
  provider: string;
  resultSummary: string;
}): Promise<void> {
  await recordExternalEvidence({
    actorUserId: input.actorUserId,
    routeContext: "deliberation",
    operationType: "retrieve",
    target: input.target,
    provider: input.provider,
    resultSummary: input.resultSummary,
    details: {
      deliberationRunId: input.deliberationRunId,
    },
  });
}
