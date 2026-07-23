// Pure evaluation core for the stewardship-scope drift gate (BI-C34E09B0). No
// filesystem or process access — every input is passed in, so the CI wrapper
// (scripts/check-stewardship-scope.mjs) does the IO and this stays unit-testable
// with fixtures. Same split as scripts/lib/archetype-completeness.mjs.
//
// THE DEFECT THIS GUARDS
// A new Prisma model is not merely un-stewarded; it is SILENTLY enrolled in
// wrong defaults:
//   • absent from TABLE_CLASSIFICATION it falls through to DEFAULT_SENSITIVITY
//     = "confidential" (packages/db/src/table-classification.ts) — a guess
//     presented as a decision;
//   • absent from PURGE_POLICIES and RETAINED_DATASETS it is never swept,
//     forever, with no warning and no gap report.
// Architecture grows, stewardship scope does not, and nothing notices.
//
// THE THIRD DISPOSITION
// The retention substrate has two axes (purge / regulated-retain), but a third
// disposition genuinely exists: reference data (Country, TaxonomyNode), config
// singletons, domain-lifecycle-managed state and derived projections belong to
// NEITHER. Today that is expressed only by ABSENCE — indistinguishable from the
// silent omission this gate exists to catch. Forcing such a model into
// PURGE_POLICIES to satisfy a gate would attach a purge window the retention
// engine actually EXECUTES, so the cure would delete reference data. We
// therefore require an explicit third disposition — a declared exemption
// carrying a typed reason — so silence becomes a stated, reviewable decision.
// Kernel decision DI-F10DB4681452 (composite 10.53 vs 5.56, margin 4.96).

/** Typed reasons a model may legitimately hold no retention disposition. */
export const EXEMPTION_REASONS = Object.freeze([
  // Reference / lookup data. Superseded by replacement, never aged out.
  "reference-data",
  // Single-row (or per-org) configuration. Lifetime is the install's lifetime.
  "config-singleton",
  // Rows are created and removed by their own domain lifecycle (e.g. a lease
  // released on completion), so a time-based sweep would race that owner.
  "domain-lifecycle-managed",
  // Derived from a source of record; rebuilt or cascaded, never independently
  // aged (e.g. a projection or join table).
  "derived-projection",
]);

/** Prisma delegate accessor for a model name: lower-cases the first character
 *  only (AgentThread -> agentThread, TokenUsage -> tokenUsage). The retention
 *  registries are keyed by delegate, TABLE_CLASSIFICATION by model name. */
export function delegateFor(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/**
 * @typedef {Object} StewardshipScopeInput
 * @property {string[]} models        Persistent Prisma model names (PascalCase).
 * @property {Set<string>} classified Models present in TABLE_CLASSIFICATION.
 * @property {Set<string>} purgeModels    PURGE_POLICIES delegates (camelCase).
 * @property {Set<string>} retainedModels RETAINED_DATASETS delegates (camelCase).
 * @property {Map<string,string>} exemptions Model (PascalCase) -> typed reason.
 * @property {Set<string>} baseline   Grandfathered models exempt from BOTH tiers.
 */

/**
 * Evaluate the two-tier floor. Returns structured results; the caller decides
 * exit code and printing.
 * @param {StewardshipScopeInput} input
 */
export function evaluateStewardshipScope(input) {
  const {
    models,
    classified,
    purgeModels,
    retainedModels,
    exemptions,
    baseline,
  } = input;

  const errors = [];
  const known = new Set(models);
  const reasons = new Set(EXEMPTION_REASONS);

  // ── Integrity checks — never grandfathered ─────────────────────────────────
  // These cannot be pre-existing debt in the way an un-stewarded model can: a
  // registry entry naming a model that does not exist is dead weight that
  // silently stewards nothing, and a model claiming two dispositions is
  // ambiguous about what the engine should do. Both fail regardless of baseline.

  for (const [model, reason] of exemptions) {
    if (!known.has(model)) {
      errors.push({
        kind: "dangling-exemption",
        model,
        detail: `declared exempt but no such Prisma model exists`,
      });
    }
    if (!reasons.has(reason)) {
      errors.push({
        kind: "invalid-exemption-reason",
        model,
        detail: `reason "${reason}" is not one of: ${EXEMPTION_REASONS.join(", ")}`,
      });
    }
  }

  for (const [label, set] of [
    ["PURGE_POLICIES", purgeModels],
    ["RETAINED_DATASETS", retainedModels],
  ]) {
    for (const delegate of set) {
      if (![...known].some((m) => delegateFor(m) === delegate)) {
        errors.push({
          kind: "dangling-registry-entry",
          model: delegate,
          detail: `${label} names "${delegate}" but no Prisma model maps to that delegate`,
        });
      }
    }
  }

  // A model may hold exactly ONE disposition. purge-vs-retained is already
  // asserted by retention.test.ts; exempt-vs-either is new with this gate.
  for (const model of models) {
    const d = delegateFor(model);
    const held = [
      purgeModels.has(d) && "a purge policy",
      retainedModels.has(d) && "a retained-dataset declaration",
      exemptions.has(model) && "a declared exemption",
    ].filter(Boolean);
    if (held.length > 1) {
      errors.push({
        kind: "conflicting-disposition",
        model,
        detail: `holds ${held.length} dispositions (${held.join(" + ")}); exactly one is allowed`,
      });
    }
  }

  // ── Tiered coverage ────────────────────────────────────────────────────────
  const coverage = {};
  for (const model of models) {
    const d = delegateFor(model);
    const hasClassification = classified.has(model);
    const hasDisposition =
      purgeModels.has(d) || retainedModels.has(d) || exemptions.has(model);
    coverage[model] = {
      hasClassification,
      hasDisposition,
      passes: hasClassification && hasDisposition,
    };

    if (coverage[model].passes) continue;
    if (baseline.has(model)) continue; // grandfathered gap — ratchets down

    const missing = [];
    if (!hasClassification) {
      missing.push("TABLE_CLASSIFICATION (packages/db/src/table-classification.ts)");
    }
    if (!hasDisposition) {
      missing.push(
        "a retention disposition — PURGE_POLICIES, RETAINED_DATASETS, or a declared exemption",
      );
    }
    errors.push({
      kind: "unstewarded-model",
      model,
      missing,
      detail: `is new (not grandfathered) and must declare its stewardship`,
    });
  }

  // Baselined models that now pass — the ratchet is available; not an error.
  const staleBaseline = [...baseline].filter(
    (m) => coverage[m] && coverage[m].passes,
  );
  // Baseline entries naming a model that no longer exists — also ratchet debt.
  const orphanBaseline = [...baseline].filter((m) => !known.has(m));

  return {
    ok: errors.length === 0,
    errors,
    coverage,
    staleBaseline,
    orphanBaseline,
    classifiedCount: models.filter((m) => coverage[m].hasClassification).length,
    dispositionCount: models.filter((m) => coverage[m].hasDisposition).length,
    completeCount: models.filter((m) => coverage[m].passes).length,
  };
}

/** Models currently below the floor (for --update baseline regeneration). */
export function modelsBelowStewardshipFloor(input) {
  const { models, classified, purgeModels, retainedModels, exemptions } = input;
  return models.filter((m) => {
    const d = delegateFor(m);
    const hasClassification = classified.has(m);
    const hasDisposition =
      purgeModels.has(d) || retainedModels.has(d) || exemptions.has(m);
    return !(hasClassification && hasDisposition);
  });
}
