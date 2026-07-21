// Pure evaluation core for the archetype completeness gate. No filesystem or
// process access — all inputs are passed in, so the CI wrapper
// (scripts/check-archetype-completeness.mjs) does the IO and this stays unit-
// testable with fixtures. Spec: docs/superpowers/specs/2026-07-21-archetype-
// provisioning-playbook-design.md.

/**
 * @typedef {Object} ArchetypeCompletenessInput
 * @property {string[]} categories        Canonical category list (PROFESSION_ARCHETYPES minus "universal").
 * @property {(c:string)=>boolean} inUnion   Is the category in the ArchetypeCategory union?
 * @property {(c:string)=>boolean} inIndustry Is the category in INDUSTRY_OPTIONS?
 * @property {Record<string,number>} corpusCounts  category -> WSID page count.
 * @property {Set<string>} decisions      Categories with a recorded coworker decision.
 * @property {Set<string>} baseline       Grandfathered categories exempt from Tier 2.
 */

/**
 * Evaluate the two-tier floor. Returns structured results; the caller decides
 * exit code and printing.
 * @param {ArchetypeCompletenessInput} input
 */
export function evaluateArchetypeCompleteness(input) {
  const { categories, inUnion, inIndustry, corpusCounts, decisions, baseline } = input;
  const errors = [];

  // Tier 1 — structural presence, blocks ALL categories.
  for (const c of categories) {
    const miss = [];
    if (!inUnion(c)) miss.push("ArchetypeCategory union (types.ts)");
    if (!inIndustry(c)) miss.push("INDUSTRY_OPTIONS (industries.ts)");
    if (miss.length > 0) {
      errors.push({ tier: 1, category: c, missing: miss });
    }
  }

  // Tier 2 — provisioning depth, blocks categories NOT grandfathered.
  const depth = {};
  for (const c of categories) {
    const hasCorpus = (corpusCounts[c] || 0) >= 1;
    const hasDecision = decisions.has(c);
    depth[c] = { hasCorpus, hasDecision, passes: hasCorpus && hasDecision };
    if (depth[c].passes) continue;
    if (baseline.has(c)) continue; // grandfathered gap — allowed, ratchets down
    const miss = [];
    if (!hasCorpus) miss.push(">=1 WSID corpus page (professionArchetype)");
    if (!hasDecision) miss.push("a coworker decision (archetype-coworker-decisions.txt)");
    errors.push({ tier: 2, category: c, missing: miss });
  }

  // Baselined categories that now pass — the ratchet is available; not an error.
  const staleBaseline = [...baseline].filter((c) => depth[c] && depth[c].passes);

  return {
    ok: errors.length === 0,
    errors,
    depth,
    staleBaseline,
    completeCount: categories.filter((c) => depth[c] && depth[c].passes).length,
  };
}

/** The set of categories currently below the Tier-2 depth floor (for --update). */
export function categoriesBelowDepthFloor(categories, corpusCounts, decisions) {
  return categories.filter(
    (c) => !((corpusCounts[c] || 0) >= 1 && decisions.has(c)),
  );
}
