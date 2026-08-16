// Trust-envelope evidence grounding — a score with no cited evidence does not
// count (BI-EA97E5CD, EP-VERIFICATION-INTEGRITY; spec §2 Axis 1).
//
// `principle_decide` scores each option as a bare map of dimension -> 0..1
// magnitude, and the kernel-consult ledger persisted `sources: []`. This module
// binds each score to a cited source and — when the caller marks the decision
// high-stakes (`requireEvidence`) — DROPS any score that lacks admissible
// evidence BEFORE scoring, so `decide()` treats it exactly like a
// `missingDimension` rather than counting an unevidenced assertion.
//
// It reuses the live evidence contract (apps/web/lib/deliberation/evidence.ts):
// a citation must normalize to a StructuredLocator, and Grade D (model memory)
// is inadmissible — the same "citation theater" refusal, lifted from
// Build-Studio scope to the kernel. Default behavior (requireEvidence=false) is
// unchanged, so every existing principle_decide caller keeps working.

import { normalizeLocator, type StructuredLocator } from "@/lib/deliberation/evidence";
import { CLAIM_EVIDENCE_GRADES, type ClaimEvidenceGrade } from "@/lib/deliberation/types";
import { digestEvidence } from "@/lib/decision/decision-chain";

/** One citation attached to a single option's single dimension score. */
export type EvidenceRef = {
  /** Structured locator (file+line, URL+ts, db-query+capturedAt, …). */
  locator: unknown;
  /** Evidence grade; A/B/C admissible, D (model memory) inadmissible. Defaults to "C". */
  grade?: ClaimEvidenceGrade;
  /** Normalized excerpt/fact text the score relies on. */
  excerpt?: string;
};

/** Caller-supplied evidence: optionId -> dimensionKey -> citations. */
export type OptionEvidenceMap = Record<string, Record<string, EvidenceRef[]>>;

/** An admissible, normalized citation ready for the ledger `sources` field. */
export type AdmissibleCitation = {
  optionId: string;
  dimensionKey: string;
  locator: StructuredLocator;
  grade: ClaimEvidenceGrade;
  excerpt: string | null;
};

export type DroppedScore = {
  optionId: string;
  dimensionKey: string;
  reason: "no-evidence" | "inadmissible-grade" | "unresolvable-locator";
};

export type GroundedOption = {
  id: string;
  description: string;
  features?: Record<string, number>;
};

export type GroundingResult = {
  /** Options with unevidenced features stripped (only when requireEvidence). */
  options: GroundedOption[];
  /** Flat list of admissible citations, for DecisionInteraction.sources. */
  citations: AdmissibleCitation[];
  /** Scores dropped for lack of admissible evidence (observable, not silent). */
  dropped: DroppedScore[];
  /** Per-(option,dimension) evidence digest, for the immutable chain payload. */
  evidenceDigests: Record<string, Record<string, string>>;
  /** True when enforcement actively ran (requireEvidence). */
  enforced: boolean;
};

function isGrade(value: unknown): value is ClaimEvidenceGrade {
  return typeof value === "string" && (CLAIM_EVIDENCE_GRADES as readonly string[]).includes(value);
}

/** A/B/C are admissible; D (unsupported model memory) is not, per §8.4. */
export function isAdmissibleGrade(grade: ClaimEvidenceGrade): boolean {
  return grade !== "D";
}

/**
 * Evaluate one option's cited evidence for one dimension. Returns the first
 * admissible citation (normalizable locator + admissible grade), or a drop reason.
 */
function admitCitation(
  optionId: string,
  dimensionKey: string,
  refs: EvidenceRef[] | undefined,
): { citation: AdmissibleCitation } | { drop: DroppedScore["reason"] } {
  if (!refs || refs.length === 0) return { drop: "no-evidence" };
  let sawInadmissibleGrade = false;
  let sawUnresolvable = false;
  for (const ref of refs) {
    const grade: ClaimEvidenceGrade = isGrade(ref.grade) ? ref.grade : "C";
    if (!isAdmissibleGrade(grade)) {
      sawInadmissibleGrade = true;
      continue;
    }
    const locator = normalizeLocator(ref.locator);
    if (!locator) {
      sawUnresolvable = true;
      continue;
    }
    return {
      citation: {
        optionId,
        dimensionKey,
        locator,
        grade,
        excerpt: typeof ref.excerpt === "string" ? ref.excerpt : null,
      },
    };
  }
  if (sawUnresolvable) return { drop: "unresolvable-locator" };
  if (sawInadmissibleGrade) return { drop: "inadmissible-grade" };
  return { drop: "no-evidence" };
}

/**
 * Bind option scores to evidence. When `requireEvidence` is true, any
 * `features[dim]` without an admissible citation is removed from the option so
 * the kernel never counts an unevidenced assertion; the removals are reported in
 * `dropped` (observable, per make-silent-failures-observable). When false, no
 * feature is removed — the citations are still collected for the audit record.
 */
export function groundOptionFeatures(input: {
  options: GroundedOption[];
  evidence?: OptionEvidenceMap;
  requireEvidence?: boolean;
}): GroundingResult {
  const evidence = input.evidence ?? {};
  const requireEvidence = input.requireEvidence === true;
  const citations: AdmissibleCitation[] = [];
  const dropped: DroppedScore[] = [];
  const evidenceDigests: Record<string, Record<string, string>> = {};

  const options = input.options.map((option): GroundedOption => {
    const features = option.features ?? {};
    const optionEvidence = evidence[option.id] ?? {};
    const keptFeatures: Record<string, number> = {};

    for (const [dimensionKey, magnitude] of Object.entries(features)) {
      const result = admitCitation(option.id, dimensionKey, optionEvidence[dimensionKey]);
      if ("citation" in result) {
        citations.push(result.citation);
        (evidenceDigests[option.id] ??= {})[dimensionKey] = digestEvidence(result.citation.locator);
        keptFeatures[dimensionKey] = magnitude;
      } else {
        dropped.push({ optionId: option.id, dimensionKey, reason: result.drop });
        // Only actually remove the score when enforcement is on. Otherwise the
        // decision scores exactly as before; the drop is advisory metadata.
        if (!requireEvidence) keptFeatures[dimensionKey] = magnitude;
      }
    }

    return option.features === undefined
      ? option
      : { ...option, features: keptFeatures };
  });

  return {
    options,
    citations,
    dropped,
    evidenceDigests,
    enforced: requireEvidence,
  };
}

/**
 * JSON-schema fragment for the `principle_decide` evidence parameters. Spread
 * into the tool `inputSchema.properties` so the pack stays under the module-size
 * ceiling and the surface never drifts from the grounding logic that reads it.
 */
export const PRINCIPLE_DECIDE_EVIDENCE_SCHEMA: Record<string, unknown> = {
  evidence: {
    type: "object",
    description:
      "Trust-envelope evidence grounding (spec §2 Axis 1). Optional map optionId -> dimensionKey -> array of citations, each { locator, grade?, excerpt? }. `locator` is a StructuredLocator ({ sourceType: 'code'|'spec'|'doc'|'db-query'|'runtime-state'|..., ... }). `grade` is A/B/C/D (D = unsupported model memory, inadmissible). When `requireEvidence` is true, any scored feature lacking an admissible citation is DROPPED before scoring — a score with no cited evidence does not count. Admissible citations are persisted onto the decision's audit record.",
    additionalProperties: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: {
          type: "object",
          properties: {
            locator: { type: "object", description: "StructuredLocator for the cited source." },
            grade: { type: "string", enum: ["A", "B", "C", "D"] },
            excerpt: { type: "string" },
          },
          required: ["locator"],
        },
      },
    },
  },
  requireEvidence: {
    type: "boolean",
    description:
      "Trust-envelope high-stakes enforcement (spec §2 Axis 1). When true, a feature with no admissible cited evidence in `evidence` is dropped before scoring (treated as a missingDimension). Set for high-risk activity classes (hiring, credit, health). Defaults false — scoring unchanged.",
  },
};

export type LedgerEvidenceArgs = {
  citations: AdmissibleCitation[];
  scoredCriteria: Record<string, Record<string, number>>;
  evidenceDigests: Record<string, Record<string, string>>;
};

/**
 * Parse a tool-call `params` object (with `options`, `evidence`, `requireEvidence`)
 * and run the grounding pass. Returns the grounded feature map keyed by option id
 * and the args the kernel-consult ledger needs. Extracted from the pack handler so
 * the hot-path module stays small.
 */
export function groundOptionsFromParams(params: Record<string, unknown>): {
  grounding: GroundingResult;
  groundedFeaturesById: Map<string, Record<string, number>>;
  ledgerArgs: LedgerEvidenceArgs;
} {
  const requireEvidence = params["requireEvidence"] === true;
  const evidence =
    typeof params["evidence"] === "object" &&
    params["evidence"] !== null &&
    !Array.isArray(params["evidence"])
      ? (params["evidence"] as OptionEvidenceMap)
      : undefined;
  const optionsParam = Array.isArray(params["options"]) ? params["options"] : [];
  const grounding = groundOptionFeatures({
    options: optionsParam
      .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
      .map((o) => ({
        id: String(o["id"] ?? ""),
        description: String(o["description"] ?? ""),
        features:
          typeof o["features"] === "object" && o["features"] !== null && !Array.isArray(o["features"])
            ? (o["features"] as Record<string, number>)
            : undefined,
      })),
    evidence,
    requireEvidence,
  });
  return {
    grounding,
    groundedFeaturesById: new Map(grounding.options.map((o) => [o.id, o.features ?? {}])),
    ledgerArgs: {
      citations: grounding.citations,
      scoredCriteria: Object.fromEntries(grounding.options.map((o) => [o.id, o.features ?? {}])),
      evidenceDigests: grounding.evidenceDigests,
    },
  };
}

/**
 * Build the scored DecisionOption[] for decide(): apply the grounded feature set
 * per option, and embed the description when the option carries no features and no
 * caller-supplied embedding (semantic path — BI-3C1A6451). Extracted from the pack
 * handler to keep it under the module-size ceiling.
 */
export async function buildScoredDecisionOptions(input: {
  optionsParam: unknown[];
  groundedFeaturesById: Map<string, Record<string, number>>;
  generateEmbedding: (text: string) => Promise<number[] | null | undefined>;
}): Promise<import("@/lib/decision/option-scoring").DecisionOption[]> {
  return Promise.all(
    input.optionsParam
      .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
      .map(async (o) => {
        const features = input.groundedFeaturesById.get(String(o["id"] ?? "")) ?? {};
        const description = String(o["description"] ?? "");
        let embedding: number[] | undefined;
        if (Array.isArray(o["embedding"])) {
          embedding = (o["embedding"] as unknown[]).map((n) => Number(n));
        } else if (Object.keys(features).length === 0 && description) {
          const e = await input.generateEmbedding(description);
          if (e) embedding = e;
        }
        return { id: String(o["id"] ?? ""), description, features, embedding };
      }),
  );
}

/** Grade → effective weight for the persisted source row. A most conclusive. */
const GRADE_WEIGHT: Record<string, number> = { A: 1, B: 0.75, C: 0.5, D: 0.25 };

/**
 * Shape the admissible citations for the DecisionInteraction.sources column.
 *
 * BI-8192557E phase 2a: the row now carries the STRUCTURED LOCATOR, not just
 * `locator.sourceType`. Re-verification (`reverifyCitations`) re-resolves a
 * locator against live source; a bare sourceType string cannot be re-resolved,
 * so before this every recorded citation was permanently unverifiable. The
 * sealed `evidenceDigests` chain proves the record was not tampered with —
 * a different property from whether the citation was ever true.
 *
 * This is the single home for the ledger source shape; the kernel-consult
 * ledger delegates here rather than re-deriving it.
 */
export function citationsToSources(
  citations: AdmissibleCitation[],
): Array<{
  materialId: string;
  sourceType: string;
  summary: string;
  effectiveWeight: number;
  locator: StructuredLocator;
  grade: ClaimEvidenceGrade;
  optionId: string;
  dimensionKey: string;
  excerpt: string | null;
}> {
  return citations.map((c) => ({
    materialId: `${c.optionId}:${c.dimensionKey}`,
    sourceType: c.locator.sourceType,
    summary: c.excerpt ?? `${c.dimensionKey} cited from ${c.locator.sourceType}`,
    effectiveWeight: GRADE_WEIGHT[c.grade] ?? 0.5,
    locator: c.locator,
    grade: c.grade,
    optionId: c.optionId,
    dimensionKey: c.dimensionKey,
    excerpt: c.excerpt,
  }));
}
