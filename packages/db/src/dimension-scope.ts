// Spine vs profession-local classification for the decision axes (BI-AA7D80FE).
//
// Extracted from wiki-taxonomy.ts, which owns the axis REGISTRY; this module
// owns the axis SCOPE POLICY. Splitting them keeps each focused (and keeps
// wiki-taxonomy under the module-size ceiling): the registry answers "what axes
// exist", this answers "which of them are shared doctrine and which belong to a
// profession".

import {
  PRINCIPLE_DIMENSIONS,
  isPrincipleDimension,
  type PrincipleDimension,
} from "./wiki-taxonomy";

// ─── Spine vs profession-local axis scope (BI-AA7D80FE) ─────────────────────
//
// Spec: docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md §2.1.
//
// The registry was sized when WWMD was the only authoring tier. Now that WSID
// (profession corpora) exists, some axes here are one profession's vocabulary
// wearing doctrine's clothes. This classification says which axes are the
// **commensurability layer** — the ones that let a design objection and a
// security objection be weighed in one ledger — and which belong to a
// profession.
//
// REDUCTION IS BY DEMOTION, NOT DELETION. Nothing leaves PRINCIPLE_DIMENSIONS.
// A demoted axis keeps scoring at full resolution inside its profession and
// **projects** onto a spine axis when the decision leaves that profession, so
// no signal is lost and cross-profession comparison still works.
//
// HOW THESE CALLS WERE MADE (measured 2026-07-24 over the 100-page kernel):
// raw usage is a BAD criterion on its own, because this spec's own finding is
// that the specialist cohort is over-represented — 53 of 100 kernel principles
// are `route-domain-specific`, mostly software-engineering. So an axis can look
// load-bearing purely because one profession authored most of the corpus. The
// better evidence is **specialist-authorship share**:
//
//   axis                        uses  authored by route-domain-specific
//   reusability                   22   64%   <- demoted
//   schema_grounding              39   51%   <- demoted despite 3rd-highest usage
//   operational_independence       4   75%   <- demoted
//   vendor_lock_in                 2  100%   <- demoted
//   capacity_utilization           6   67%   <- demoted
//   reversibility                  2    0%   <- SPINE despite 2 uses
//   data_privacy                   1    0%   <- SPINE despite 1 use
//   legibility_of_consequence      4    0%   <- SPINE (and young)
//
// Two guards against misreading low usage:
//   - **Universal obligations outrank frequency.** `public_safety` (3 uses) and
//     `data_privacy` (1 use) stay spine. If a safety objection could not be
//     weighed against a design objection in one ledger, the spine would have
//     failed at its only job.
//   - **Young axes are protected.** `operator_effort` and
//     `legibility_of_consequence` landed 2026-07-23 (BI-B5EA2FB2). Their low
//     counts measure their age, not their reach. Demoting an axis in its first
//     week would encode "new axes are niche", which is backwards.

/** Whether an axis is shared doctrine or one profession's vocabulary. */
export const PRINCIPLE_DIMENSION_SCOPES = ["spine", "profession-local"] as const;
export type PrincipleDimensionScope =
  (typeof PRINCIPLE_DIMENSION_SCOPES)[number];

export type PrincipleDimensionScopeEntry =
  | {
      scope: "spine";
      /** Why this axis must stay commensurable across every profession. */
      rationale: string;
    }
  | {
      scope: "profession-local";
      /** Profession slug that owns the axis (see docs/professions/registry.json). */
      profession: string;
      /**
       * Spine axes this rolls up onto when the decision leaves the profession.
       * MUST be non-empty — a demotion without a projection silently drops the
       * axis from cross-profession decisions, which is deletion wearing a
       * demotion's name. Enforced by `assertDimensionScopeIntegrity`.
       */
      projectsOnto: readonly PrincipleDimension[];
      rationale: string;
    };

/**
 * Every axis, labelled. `satisfies Record<PrincipleDimension, …>` is the
 * enforcement: adding a dimension to PRINCIPLE_DIMENSIONS without classifying
 * it here is a COMPILE error, not a silently-unlabelled axis. Same discipline
 * as the quality-issue registry — an unregistered entry must not typecheck.
 */
export const PRINCIPLE_DIMENSION_SCOPE = {
  // ── Spine ────────────────────────────────────────────────────────────────
  long_term_maintainability: {
    scope: "spine",
    rationale:
      "Durability is profession-neutral: a contract, a menu, a network topology and a module all get more expensive to keep correct over time. The heaviest specialist share (57%) reflects who authored the corpus, not what the axis means.",
  },
  governance_compliance: {
    scope: "spine",
    rationale:
      "Policy and audit obligations bind every profession; an option that satisfies them must be comparable to one that does not, wherever the objection originates.",
  },
  evidence_density: {
    scope: "spine",
    rationale:
      "How much verifiable backing an option has, rather than assertion, is the platform's shared epistemic floor.",
  },
  speed_to_value: {
    scope: "spine",
    rationale:
      "Time-to-usable-outcome is the universal trade partner for every quality axis. Lowest specialist share (37%) of the high-usage axes.",
  },
  blast_radius: {
    scope: "spine",
    rationale:
      "How much of the estate an option reaches if it is wrong is the shared risk currency — the axis a security objection and an architecture objection both speak.",
  },
  human_cognitive_load: {
    scope: "spine",
    rationale:
      "Demand on human attention and judgement is borne by the same humans regardless of which profession produced the option.",
  },
  public_safety: {
    scope: "spine",
    rationale:
      "UNIVERSAL OBLIGATION, not frequency: 3 uses. Harm to people outside the organization must be weighable against any other objection in one ledger. Demoting it to a profession would mean a safety concern could not be compared to a design concern — precisely the failure the spine exists to prevent.",
  },
  data_privacy: {
    scope: "spine",
    rationale:
      "UNIVERSAL OBLIGATION, not frequency: 1 use, 0% specialist-authored. Protection of personal data is a legal duty crossing every profession, so it cannot be scoped to one.",
  },
  reversibility: {
    scope: "spine",
    rationale:
      "Whether an action can be undone is a property of ANY action, in any profession. 0% specialist-authored despite only 2 uses — authored by universal principles, which is the signal.",
  },
  cost_efficiency: {
    scope: "spine",
    rationale:
      "Money is the one axis every profession trades against. Scored by ZERO principles today, which §2.1 names as the explicit exception to the demote-if-rarely-used rule: an unused axis here means the corpus has a gap, not that the axis is niche. A cost-sensitivity principle is scoped in BI-8D3E7757.",
  },
  operator_effort: {
    scope: "spine",
    rationale:
      "YOUNG AXIS (landed 2026-07-23, BI-B5EA2FB2): 3 uses measures its age, not its reach. Operations and elapsed time demanded of the operator are borne identically whichever profession authored the option.",
  },
  legibility_of_consequence: {
    scope: "spine",
    rationale:
      "YOUNG AXIS (landed 2026-07-23, BI-B5EA2FB2): 4 uses, 0% specialist-authored. Whether an operator can foresee what an action will do before authorizing it is a precondition of informed authorization everywhere, not a design-profession concern.",
  },

  // ── Profession-local (demoted; each projects back onto the spine) ─────────
  schema_grounding: {
    scope: "profession-local",
    profession: "software-engineer",
    projectsOnto: ["long_term_maintainability"],
    rationale:
      "THE LARGEST DEMOTION, and the clearest instance of this spec's thesis: 39 uses (3rd highest) but 51% specialist-authored, and the axis is literally named in software vocabulary — 'anchored in the existing schema and substrate'. Its apparent load-bearing weight comes from the software cohort's over-representation in the kernel. Grounding work in existing substrate is how software buys durability, so it rolls up onto long_term_maintainability.",
  },
  reusability: {
    scope: "profession-local",
    profession: "software-engineer",
    projectsOnto: ["long_term_maintainability"],
    rationale:
      "Highest specialist share of any well-used axis (64% of 22 uses). 'Reusable across more callers and contexts' is software-engineering framing; the durable value it buys is what other professions can actually compare against.",
  },
  operational_independence: {
    scope: "profession-local",
    profession: "devops-platform",
    projectsOnto: ["long_term_maintainability", "blast_radius"],
    rationale:
      "75% specialist-authored. Sovereignty from external dependencies is an infrastructure property; its cross-profession meaning is continuity (durability) plus exposure when the dependency fails (reach).",
  },
  vendor_lock_in: {
    scope: "profession-local",
    profession: "devops-platform",
    projectsOnto: ["long_term_maintainability"],
    rationale:
      "100% specialist-authored (2 uses). Depth of tie to a single vendor is a procurement/architecture concern whose general form is the future cost of staying correct.",
  },
  capacity_utilization: {
    scope: "profession-local",
    profession: "operations",
    projectsOnto: ["cost_efficiency"],
    rationale:
      "67% specialist-authored. Fuller use of available capacity is operations vocabulary; what every other profession can weigh is the cheaper outcome it produces.",
  },
  evidence_confidence: {
    scope: "profession-local",
    profession: "security",
    projectsOnto: ["evidence_density"],
    rationale:
      "Introduced for SOC verdicts (EP-SOVEREIGN-SOC). How CONCLUSIVE an investigation is, is a distinct analytic judgement from how MUCH evidence exists, but only security work routinely separates the two; elsewhere it rolls up onto evidence_density.",
  },
  business_disruption: {
    scope: "profession-local",
    profession: "security",
    projectsOnto: ["blast_radius"],
    rationale:
      "Introduced for SOC containment decisions. 'Does the response break production' is a security-response framing of estate reach, which is what other professions weigh it as.",
  },
  customer_consent_state: {
    scope: "profession-local",
    profession: "marketing",
    projectsOnto: ["governance_compliance"],
    rationale:
      "Breadth of standing customer approval governs outbound and consent-bound action. Outside that work its force is exactly the compliance obligation it encodes.",
  },
} as const satisfies Record<PrincipleDimension, PrincipleDimensionScopeEntry>;

/** Axes that form the shared commensurability layer. */
export const PRINCIPLE_SPINE_DIMENSIONS = PRINCIPLE_DIMENSIONS.filter(
  (d) => PRINCIPLE_DIMENSION_SCOPE[d].scope === "spine",
) as readonly PrincipleDimension[];

/** Axes owned by a profession, each projecting back onto the spine. */
export const PRINCIPLE_LOCAL_DIMENSIONS = PRINCIPLE_DIMENSIONS.filter(
  (d) => PRINCIPLE_DIMENSION_SCOPE[d].scope === "profession-local",
) as readonly PrincipleDimension[];

export function isSpineDimension(d: PrincipleDimension): boolean {
  return PRINCIPLE_DIMENSION_SCOPE[d].scope === "spine";
}

/**
 * Project a dimension vector onto the spine — the roll-up that makes a
 * profession-scored decision comparable outside that profession. Spine axes
 * pass through; a profession-local axis contributes its weight to each spine
 * axis it declares, split evenly so a demotion cannot amplify a principle by
 * projecting onto several axes at full magnitude.
 */
export function projectVectorOntoSpine(
  vector: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => {
    out[k] = (out[k] ?? 0) + v;
  };
  for (const [key, value] of Object.entries(vector)) {
    if (!isPrincipleDimension(key)) continue;
    const entry = PRINCIPLE_DIMENSION_SCOPE[key];
    if (entry.scope === "spine") {
      add(key, value);
      continue;
    }
    const share = value / entry.projectsOnto.length;
    for (const target of entry.projectsOnto) add(target, share);
  }
  return out;
}

/**
 * Structural invariants that the type system cannot express. Called by the
 * registry test so a bad classification fails CI rather than silently
 * degrading a decision.
 */
export function assertDimensionScopeIntegrity(
  /**
   * Valid `professionKey` values from docs/professions/registry.json. Passed in
   * rather than read here so this module stays filesystem-free (it is imported
   * by the browser bundle); the registry test supplies the real set.
   */
  knownProfessions?: ReadonlySet<string>,
): void {
  for (const dim of PRINCIPLE_DIMENSIONS) {
    const entry = PRINCIPLE_DIMENSION_SCOPE[dim];
    if (entry.scope !== "profession-local") continue;
    // Widened deliberately: `as const` narrows these literal tuples to length
    // 1 | 2, so TS proves the check dead for TODAY's registry. The guard exists
    // for the NEXT author, who may add an entry with an empty projection — at
    // which point the literal type would permit 0 and this would fire.
    if ((entry.projectsOnto as readonly PrincipleDimension[]).length === 0) {
      throw new Error(
        `Dimension "${dim}" is profession-local with no projection. A demotion without a projection drops the axis from every cross-profession decision — that is deletion, which §2.1 forbids.`,
      );
    }
    for (const target of entry.projectsOnto) {
      const targetEntry = PRINCIPLE_DIMENSION_SCOPE[target];
      if (targetEntry.scope !== "spine") {
        throw new Error(
          `Dimension "${dim}" projects onto "${target}", which is itself profession-local. Projections must terminate on the spine in one hop, or the roll-up is not commensurable.`,
        );
      }
    }
    if (!entry.profession.trim()) {
      throw new Error(`Dimension "${dim}" is profession-local with no owning profession.`);
    }
    if (knownProfessions && !knownProfessions.has(entry.profession)) {
      throw new Error(
        `Dimension "${dim}" is owned by profession "${entry.profession}", which is not a professionKey in docs/professions/registry.json. A local axis owned by a profession that does not exist can never be retrieved.`,
      );
    }
  }
  if (PRINCIPLE_SPINE_DIMENSIONS.length === 0) {
    throw new Error("The spine cannot be empty — it is the commensurability layer.");
  }
}
