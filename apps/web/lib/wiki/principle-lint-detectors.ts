// Phase 1 of the principles-as-wiki-kind plan: pure lint detectors for
// principle pages. Cross-page detectors (commandment cap, duplicate,
// contradiction) live in their own files and are wired into the
// orchestrator via runDetectors.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1)
//
// Detectors are pure functions, no I/O. They take a typed snapshot of
// principle pages and return findings. Storage-layer accepts incomplete
// principle data; required-field gating lives here.

import {
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_TIER_DEFAULT_WEIGHT,
  isPrincipleDimension,
} from "@dpf/db/wiki-taxonomy";
import type { LintFinding, LintWikiPage } from "./lint-detectors";

// ─── Snapshot extension ─────────────────────────────────────────────────────

/**
 * Principle-aware extension of LintWikiPage. The orchestrator's snapshot
 * fetcher (lint.ts asLintWikiPage) populates these fields from Prisma rows;
 * detectors here read them.
 */
export type LintPrincipleWikiPage = LintWikiPage & {
  principleTier: string | null;
  principleDirection: string | null;
  principleWeight: number | null;
  principleWeightRationale: string | null;
  principleDimensionVector: Record<string, number> | null;
  principleDimensions: string[];
  principleAppliesTo: string[];
  principlePublic: boolean;
  principlePublicRationale: string | null;
  /** Used by detectPrincipleCommandmentCapExceeded for newest-first ordering. */
  lastReviewedAt: Date | null;
};

// ─── Shared helpers ─────────────────────────────────────────────────────────

function principlePages(
  pages: LintPrincipleWikiPage[],
): LintPrincipleWikiPage[] {
  return pages.filter((p) => p.pageKind === "principle");
}

function baseFinding(
  page: LintPrincipleWikiPage,
  findingKind: string,
  severity: "info" | "warn" | "error",
  blocksPublish: boolean,
  extraDetail: Record<string, unknown> = {},
): LintFinding {
  return {
    organizationId: page.organizationId,
    pageId: page.id,
    // findingKind values are widened in lint-detectors.ts; cast is safe
    // here because we declare the new kinds in that union.
    findingKind: findingKind as LintFinding["findingKind"],
    severity,
    detail: {
      slug: page.slug,
      blocksPublish,
      ...extraDetail,
    },
  };
}

// ─── 1. principle-missing-tier ──────────────────────────────────────────────

/**
 * Every principle page must declare a tier. Without a tier, retrieval can't
 * stratify the principle (commandment/core/contextual) and decision math
 * can't assign a weight.
 *
 * Severity: error. Blocks publish.
 */
export function detectPrincipleMissingTier(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    if (page.principleTier === null) {
      findings.push(
        baseFinding(page, "principle-missing-tier", "error", true, {
          message:
            "Principle page has no tier. Set principleTier to one of " +
            "commandment / core / contextual.",
        }),
      );
    }
  }
  return findings;
}

// ─── 2. principle-missing-applies-to ────────────────────────────────────────

/**
 * Every principle must declare which population it governs. An empty
 * applies-to means the principle never enters any retrieval scope and is
 * effectively dead governance.
 *
 * Severity: error. Blocks publish.
 */
export function detectPrincipleMissingAppliesTo(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    if (page.principleAppliesTo.length === 0) {
      findings.push(
        baseFinding(page, "principle-missing-applies-to", "error", true, {
          message:
            "Principle page has empty principleAppliesTo. Declare at least " +
            "one of in_platform_coworker / external_coding_agent / human.",
        }),
      );
    }
  }
  return findings;
}

// ─── 3. principle-missing-direction (tier-gated severity) ───────────────────

/**
 * Commandment and core principles must have a one-clause direction. Without
 * it, passive recall has nothing to surface and decision math has nothing
 * to anchor structured alignment against.
 *
 * Severity: error for commandment + core (blocks publish), warn for
 * contextual (does not block — contextual rules are narrow enough that the
 * body often carries the direction).
 */
export function detectPrincipleMissingDirection(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    if (page.principleDirection !== null && page.principleDirection !== "") {
      continue;
    }
    if (page.principleTier === null) {
      // missing-tier covers this case
      continue;
    }
    if (page.principleTier === "commandment" || page.principleTier === "core") {
      findings.push(
        baseFinding(page, "principle-missing-direction", "error", true, {
          tier: page.principleTier,
          message:
            "Principle page missing principleDirection. Add a one-clause " +
            "statement of what this principle favors.",
        }),
      );
    } else if (page.principleTier === "contextual") {
      findings.push(
        baseFinding(page, "principle-missing-direction", "warn", false, {
          tier: page.principleTier,
          message:
            "Contextual principle missing principleDirection. Recommended " +
            "but not blocking — narrow rules can sometimes carry direction " +
            "in the body.",
        }),
      );
    }
  }
  return findings;
}

// ─── 4. principle-missing-vector ────────────────────────────────────────────

/**
 * Commandment principles need an explicit signed dimension vector — they're
 * the highest-weight rules and the math has to be inspectable. Core
 * principles are recommended to declare a vector (warn). Contextual rules
 * can omit; the math falls back to semantic alignment.
 */
export function detectPrincipleMissingVector(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    const v = page.principleDimensionVector;
    const isEmpty = v === null || Object.keys(v).length === 0;
    if (!isEmpty) continue;

    if (page.principleTier === "commandment") {
      findings.push(
        baseFinding(page, "principle-missing-vector", "error", true, {
          tier: page.principleTier,
          message:
            "Commandment principle missing principleDimensionVector. " +
            "Commandments must declare an inspectable signed dimension vector.",
        }),
      );
    } else if (page.principleTier === "core") {
      findings.push(
        baseFinding(page, "principle-missing-vector", "warn", false, {
          tier: page.principleTier,
          message:
            "Core principle missing principleDimensionVector. Recommended " +
            "so decision math can apply structured alignment.",
        }),
      );
    }
  }
  return findings;
}

// ─── 5. principle-vector-dimension-mismatch ─────────────────────────────────

/**
 * principleDimensions should mirror the keys of principleDimensionVector.
 * A mismatch indicates the author edited one without the other or hit a
 * seed-derivation gap. Surface for review; don't block.
 */
export function detectPrincipleVectorDimensionMismatch(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    const v = page.principleDimensionVector;
    if (v === null) continue;
    const vectorKeys = Object.keys(v);
    const declared = page.principleDimensions;
    if (vectorKeys.length === 0 && declared.length === 0) continue;

    const sameLength = vectorKeys.length === declared.length;
    const declaredSet = new Set(declared);
    const allMatch =
      sameLength && vectorKeys.every((k) => declaredSet.has(k));
    if (allMatch) continue;

    findings.push(
      baseFinding(page, "principle-vector-dimension-mismatch", "warn", false, {
        vectorKeys,
        principleDimensions: declared,
        message:
          "principleDimensions does not match principleDimensionVector keys. " +
          "Either re-derive principleDimensions from the vector or update the " +
          "vector to match.",
      }),
    );
  }
  return findings;
}

// ─── 6. principle-unknown-dimension ─────────────────────────────────────────

/**
 * Every dimension referenced (in vector keys OR in the principleDimensions
 * array) must be in the PRINCIPLE_DIMENSIONS registry. Unknown dimensions
 * indicate either a typo or that the registry needs an explicit follow-up
 * spec to add the axis.
 *
 * Severity: error. Blocks publish.
 */
export function detectPrincipleUnknownDimension(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    const unknown = new Set<string>();
    if (page.principleDimensionVector) {
      for (const key of Object.keys(page.principleDimensionVector)) {
        if (!isPrincipleDimension(key)) unknown.add(key);
      }
    }
    for (const dim of page.principleDimensions) {
      if (!isPrincipleDimension(dim)) unknown.add(dim);
    }
    if (unknown.size === 0) continue;

    findings.push(
      baseFinding(page, "principle-unknown-dimension", "error", true, {
        unknownDimensions: Array.from(unknown).sort(),
        registry: PRINCIPLE_DIMENSIONS,
        message:
          "Principle references dimensions outside the registry. Add them " +
          "to PRINCIPLE_DIMENSIONS in wiki-taxonomy.ts via a follow-up spec " +
          "before referencing them, or fix the typo.",
      }),
    );
  }
  return findings;
}

// ─── 7. principle-tier-weight-mismatch ──────────────────────────────────────

/**
 * If principleWeight diverges from PRINCIPLE_TIER_DEFAULT_WEIGHT[tier], the
 * author must supply principleWeightRationale. Otherwise the divergence
 * looks accidental.
 *
 * Severity: warn. Doesn't block publish — the math still works with the
 * override; lint just demands a paper trail.
 */
export function detectPrincipleTierWeightMismatch(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    const override = page.principleWeight;
    if (override === null) continue;
    if (page.principleTier === null) continue;
    const tier = page.principleTier as keyof typeof PRINCIPLE_TIER_DEFAULT_WEIGHT;
    const defaultWeight = PRINCIPLE_TIER_DEFAULT_WEIGHT[tier];
    if (defaultWeight === undefined) continue;
    if (override === defaultWeight) continue;
    if (page.principleWeightRationale) continue;

    findings.push(
      baseFinding(page, "principle-tier-weight-mismatch", "warn", false, {
        tier: page.principleTier,
        defaultWeight,
        overrideWeight: override,
        message:
          "principleWeight diverges from the tier default with no " +
          "principleWeightRationale. Add a rationale or restore the default.",
      }),
    );
  }
  return findings;
}

// ─── 8. principle-public-missing-rationale ──────────────────────────────────

/**
 * Public principles need a rationale field so the founder kernel records
 * WHY a principle is safe for external readers. Internal principles need no
 * rationale.
 *
 * Severity: warn. Doesn't block publish.
 */
export function detectPrinciplePublicMissingRationale(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    if (!page.principlePublic) continue;
    if (
      page.principlePublicRationale !== null &&
      page.principlePublicRationale !== ""
    ) {
      continue;
    }
    findings.push(
      baseFinding(page, "principle-public-missing-rationale", "warn", false, {
        message:
          "Public principle missing principlePublicRationale. State why " +
          "this principle is safe and useful for external readers.",
      }),
    );
  }
  return findings;
}
