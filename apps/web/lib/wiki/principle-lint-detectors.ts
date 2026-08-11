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
  PRINCIPLE_RING_SCOPES,
  PRINCIPLE_TIER_DEFAULT_WEIGHT,
  isPrincipleDimension,
  isPrincipleRingScope,
} from "@dpf/db/wiki-taxonomy";
import type { PrincipleRuntimeEnforcement } from "@dpf/db/wiki-frontmatter";
import type { LintFinding, LintWikiPage } from "./lint-detectors";
import { detectPrinciplePublicUnsafeMarker } from "./principle-public-safety";

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
  /**
   * Ring scope — spec
   * `2026-05-24-founder-kernel-evolution-discipline-design.md` §3. Closed
   * enum at the application layer; lint detectors below validate values
   * against `PRINCIPLE_RING_SCOPES` and surface overuse of `universal-ring`.
   */
  principleRingScope: string[];
  principlePublic: boolean;
  principlePublicRationale: string | null;
  /**
   * Runtime enforcement payload (spec 2026-05-24, BI-43F95F77). Lint
   * validates regex compilability + rationale presence + mode validity.
   * Detector defined below.
   */
  principleRuntimeEnforcement: PrincipleRuntimeEnforcement | null;
  /**
   * Originally used by the commandment-cap detector for newest-first ordering.
   * Detector removed 2026-05-22 with the cap; field retained because principle
   * similarity / drift detection still consult it.
   */
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

// ─── 4b. principle-sparse-vector (BI-6006E35D) ──────────────────────────────

/** Commandments need enough independent axes to discriminate (rank, not count). */
export const COMMANDMENT_MIN_VECTOR_KEYS = 3;
/** Core principles recommended floor for structured discrimination. */
export const CORE_MIN_VECTOR_KEYS = 3;

/**
 * Sparse dimension vectors collapse the decision space onto a few axes.
 * Warn when a commandment or core principle declares a non-empty vector
 * with fewer than the floor of non-zero keys (BI-6006E35D / MCDA rank).
 */
export function detectPrincipleSparseVector(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    const v = page.principleDimensionVector;
    if (v === null) continue;
    const keyCount = Object.keys(v).length;
    if (keyCount === 0) continue; // missing-vector detector owns empty

    if (page.principleTier === "commandment" && keyCount < COMMANDMENT_MIN_VECTOR_KEYS) {
      findings.push(
        baseFinding(page, "principle-sparse-vector", "warn", false, {
          tier: page.principleTier,
          keyCount,
          minKeys: COMMANDMENT_MIN_VECTOR_KEYS,
          message:
            `Commandment vector has only ${keyCount} axis key(s); recommend ≥${COMMANDMENT_MIN_VECTOR_KEYS} ` +
            "so structured scoring can discriminate options (BI-6006E35D).",
        }),
      );
    } else if (page.principleTier === "core" && keyCount < CORE_MIN_VECTOR_KEYS) {
      findings.push(
        baseFinding(page, "principle-sparse-vector", "warn", false, {
          tier: page.principleTier,
          keyCount,
          minKeys: CORE_MIN_VECTOR_KEYS,
          message:
            `Core principle vector has only ${keyCount} axis key(s); recommend ≥${CORE_MIN_VECTOR_KEYS} ` +
            "for structured discrimination (BI-6006E35D).",
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

// ─── Aggregator ─────────────────────────────────────────────────────────────

/**
 * Run every principle detector against a typed snapshot of principle
 * pages and return the union of findings. Mirrors the shape of
 * `runDetectors` in lint-detectors.ts; the orchestrator (lint.ts
 * runWikiLint) calls this in addition to the original aggregator.
 *
 * Cross-page detectors (commandment-cap) and the public-safety detector
 * are included here. The Qdrant-dependent detectors (duplicate,
 * contradiction-review) live in their own modules because they need
 * embedding similarity infrastructure that pure per-page detectors do
 * not — they are wired in by the orchestrator in a follow-up commit.
 */
export function runPrincipleDetectors(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  return [
    ...detectPrincipleMissingTier(input),
    ...detectPrincipleMissingAppliesTo(input),
    ...detectPrincipleMissingDirection(input),
    ...detectPrincipleMissingVector(input),
    ...detectPrincipleSparseVector(input),
    ...detectPrincipleVectorDimensionMismatch(input),
    ...detectPrincipleUnknownDimension(input),
    ...detectPrincipleTierWeightMismatch(input),
    ...detectPrinciplePublicMissingRationale(input),
    ...detectPrinciplePublicUnsafeMarker(input),
    ...detectPrincipleRuntimeEnforcement(input),
    ...detectPrincipleRingScopeUnknown(input),
    ...detectPrincipleRingScopeOveruse(input),
  ];
}

// ─── 10. principle-ring-scope-unknown ───────────────────────────────────────

/**
 * Every value in `principleRingScope` must be in the
 * `PRINCIPLE_RING_SCOPES` registry. Unknown values either indicate a typo
 * or that the registry needs an explicit follow-up spec to add the value.
 *
 * Severity: error. Blocks publish — silent skip on bad ring scope would
 * defeat the whole point of the field.
 */
export function detectPrincipleRingScopeUnknown(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    const unknown = page.principleRingScope.filter(
      (scope) => !isPrincipleRingScope(scope),
    );
    if (unknown.length === 0) continue;
    findings.push(
      baseFinding(page, "principle-ring-scope-unknown", "error", true, {
        unknownRingScopes: unknown,
        registry: PRINCIPLE_RING_SCOPES,
        message:
          "Principle references ring scopes outside the registry. Add them " +
          "to PRINCIPLE_RING_SCOPES in wiki-taxonomy.ts via a follow-up spec " +
          "before referencing them, or fix the typo.",
      }),
    );
  }
  return findings;
}

// ─── 11. principle-ring-scope-overuse ───────────────────────────────────────

/**
 * Cross-page detector: warn when too many published principles tag
 * `universal-ring`. The bar mirrors the scope-refactor plan's
 * `principle-universal-overuse` discipline (proposed in Phase D of
 * `docs/superpowers/plans/2026-05-22-principle-scope-refactor.md`).
 *
 * Both fire at warn-severity above 30%, both push authors to declare
 * specific ring scopes rather than default-to-broadest.
 *
 * Threshold rationale: 30% leaves room for genuine cross-cutting
 * principles (e.g., `architecture-over-shortcuts`, `never-fabricate`)
 * while pressing authors to think about whether a new principle truly
 * binds every ring. Tunable via constant below.
 */
const RING_SCOPE_UNIVERSAL_OVERUSE_RATIO = 0.3;

export function detectPrincipleRingScopeOveruse(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const published = principlePages(input.pages).filter(
    (p) => p.status === "published",
  );
  if (published.length === 0) return [];

  const universalCount = published.filter((p) =>
    p.principleRingScope.includes("universal-ring"),
  ).length;
  const ratio = universalCount / published.length;
  if (ratio <= RING_SCOPE_UNIVERSAL_OVERUSE_RATIO) return [];

  // Surface on every published universal-ring principle so the operator
  // sees the cluster rather than one arbitrary scapegoat. Each finding
  // points at the same threshold + ratio for context.
  const findings: LintFinding[] = [];
  for (const page of published) {
    if (!page.principleRingScope.includes("universal-ring")) continue;
    findings.push(
      baseFinding(page, "principle-ring-scope-overuse", "warn", false, {
        universalCount,
        publishedCount: published.length,
        ratio,
        threshold: RING_SCOPE_UNIVERSAL_OVERUSE_RATIO,
        message:
          `${universalCount}/${published.length} published principles ` +
          `(${Math.round(ratio * 100)}%) tag universal-ring, exceeding ` +
          `the ${Math.round(RING_SCOPE_UNIVERSAL_OVERUSE_RATIO * 100)}% ` +
          `discipline threshold. Tighten ring scope on the principles ` +
          `that don't genuinely bind every ring.`,
      }),
    );
  }
  return findings;
}

// ─── 9. principle-runtime-enforcement validation ────────────────────────────

/**
 * Runtime-enforcement frontmatter (spec 2026-05-24, BI-43F95F77) must:
 *   1. Have both interactiveMode + autonomousMode set to a valid value
 *      (warn | confirm | refuse).
 *   2. Carry at least one pattern (an empty patterns array means the
 *      principle is decision-time-only — it should NOT have the runtime
 *      block at all).
 *   3. Each pattern's regex (shell|sql|git kinds) must compile under JS
 *      RegExp semantics, INCLUDING the inline-flag prefix lifted by the
 *      gate's compileRegex helper (`(?i)`, `(?im)`, etc. at start of
 *      pattern only).
 *   4. Each pattern must have a non-empty rationale.
 *   5. mcp_tool patterns must have a non-empty toolName.
 *
 * Severity: error for invalid regex (silent gate miss = data loss);
 * warn for missing rationale (gate works but operator sees blank message);
 * error for invalid modes (gate refuses to load principle, silent disable).
 */
const VALID_MODES = new Set(["warn", "confirm", "refuse"]);

function tryCompileRegex(rawPattern: string): boolean {
  const inlineFlagMatch = rawPattern.match(/^\(\?([a-z]+)\)/);
  try {
    if (inlineFlagMatch) {
      new RegExp(rawPattern.slice(inlineFlagMatch[0].length), inlineFlagMatch[1]);
    } else {
      new RegExp(rawPattern);
    }
    return true;
  } catch {
    return false;
  }
}

export function detectPrincipleRuntimeEnforcement(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of principlePages(input.pages)) {
    const rte = page.principleRuntimeEnforcement;
    if (rte === null || rte === undefined) continue;

    if (!VALID_MODES.has(rte.interactiveMode) || !VALID_MODES.has(rte.autonomousMode)) {
      findings.push(
        baseFinding(page, "runtime-enforcement-invalid-mode", "error", true, {
          message:
            "principleRuntimeEnforcement.interactiveMode / autonomousMode must be one of " +
            "warn / confirm / refuse.",
          interactiveMode: rte.interactiveMode,
          autonomousMode: rte.autonomousMode,
        }),
      );
    }

    if (!Array.isArray(rte.patterns) || rte.patterns.length === 0) {
      findings.push(
        baseFinding(page, "runtime-enforcement-empty-patterns", "warn", false, {
          message:
            "principleRuntimeEnforcement.patterns is empty — remove the runtime block " +
            "entirely if the principle is decision-time-only.",
        }),
      );
      continue;
    }

    rte.patterns.forEach((pattern, index) => {
      const rationale = (pattern as { rationale?: string }).rationale ?? "";
      if (typeof rationale !== "string" || rationale.trim().length === 0) {
        findings.push(
          baseFinding(page, "runtime-enforcement-missing-rationale", "warn", false, {
            message: `Pattern at index ${index} has no rationale — operator sees a blank refuse message.`,
            patternIndex: index,
          }),
        );
      }
      if (pattern.kind === "mcp_tool") {
        if (typeof pattern.toolName !== "string" || pattern.toolName.length === 0) {
          findings.push(
            baseFinding(page, "runtime-enforcement-invalid-tool-name", "error", true, {
              message: `mcp_tool pattern at index ${index} has empty toolName.`,
              patternIndex: index,
            }),
          );
        }
      } else if (pattern.kind === "shell" || pattern.kind === "sql" || pattern.kind === "git") {
        if (typeof pattern.regex !== "string" || pattern.regex.length === 0) {
          findings.push(
            baseFinding(page, "runtime-enforcement-invalid-regex", "error", true, {
              message: `${pattern.kind} pattern at index ${index} has empty regex.`,
              patternIndex: index,
            }),
          );
        } else if (!tryCompileRegex(pattern.regex)) {
          findings.push(
            baseFinding(page, "runtime-enforcement-invalid-regex", "error", true, {
              message: `${pattern.kind} pattern at index ${index} regex does not compile under JS RegExp (with inline-flag prefix support).`,
              patternIndex: index,
              regex: pattern.regex,
            }),
          );
        }
      }
    });
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
