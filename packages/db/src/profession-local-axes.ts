// Profession-local decision axes (BI-106C2585).
//
// Spec: docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md §2.2
// Plan: docs/superpowers/plans/2026-07-24-profession-local-decision-axes.md
//
// PRINCIPLE_DIMENSIONS is the SPINE — the axes every profession trades against,
// deliberately kept small (BI-AA7D80FE). But a profession-specific trade-off has
// nowhere to land in that flat space, so it gets crushed into the nearest
// generic axis: a UX judgment about typographic hierarchy vs information density
// collapses into `human_cognitive_load` and becomes indistinguishable from a
// build-queue latency concern.
//
// The fix is NOT to widen the spine — that re-inflates what spine reduction just
// shrank, and makes every profession reason over every other profession's
// vocabulary. It is to let a profession declare axes INSIDE its own corpus,
// scored at full resolution there and PROJECTED onto the spine when the decision
// leaves the profession. Vectors multiply where the criteria actually live,
// without inflating the shared space.
//
// This module is Phase 1: the registry and its integrity rules. It reuses the
// projection machinery from dimension-scope.ts (BI-AA7D80FE) rather than
// re-deriving it. Threading the caller's profession into principle_decide
// (Phase 2) and the feature-key/scoring wiring (Phase 3) are separate slices
// that touch the retrieval path and need live verification; this slice is
// substrate-only and enforced entirely at compile + test time.

import {
  PRINCIPLE_DIMENSIONS,
  isPrincipleDimension,
  type PrincipleDimension,
} from "./wiki-taxonomy";
import { isSpineDimension } from "./dimension-scope";

/** benefit = higher is better; cost = higher is worse (negative weight). */
export type ProfessionLocalAxisKind = "benefit" | "cost";

export type ProfessionLocalAxis = {
  /** professionKey from docs/professions/registry.json that owns this axis. */
  profession: string;
  /**
   * Namespaced axis key: `<profession>/<axis>`. Namespacing is load-bearing —
   * it guarantees a local axis can never collide with a spine axis (which are
   * bare keys) or with another profession's axis, so a bare feature key is
   * unambiguously spine and a namespaced one is unambiguously local.
   */
  key: string;
  kind: ProfessionLocalAxisKind;
  /** What a HIGH (near 1.0) score asserts about the option. */
  highMeans: string;
  /**
   * Spine axes this rolls up onto when the decision leaves the profession.
   * MUST be non-empty and every target MUST be a spine axis — a local axis with
   * no projection would silently vanish from every cross-profession decision,
   * which breaks the commensurability the spine exists to provide.
   */
  projectsOnto: readonly PrincipleDimension[];
  /**
   * Provenance. Inherits the WSID invariant unchanged: a local axis without a
   * cited source cannot publish. Kept as a plain string key (e.g.
   * `ietf/rfc-9110`) mirroring the corpus `sources` frontmatter.
   */
  source: string;
};

/**
 * The registry. Ships EMPTY: the machinery lands proven, and the first real
 * axis lands with the profession that needs it (same discipline as
 * WIKI_SLUG_MIGRATIONS). A worked example lives only in the test, so this array
 * is never non-empty without a corresponding corpus that scores it.
 */
export const PROFESSION_LOCAL_AXES: readonly ProfessionLocalAxis[] = [];

/** Namespaced key for a profession-local axis. */
export function localAxisKey(profession: string, axis: string): string {
  return `${profession}/${axis}`;
}

/** Every local axis owned by one profession. */
export function localAxesFor(
  profession: string,
  registry: readonly ProfessionLocalAxis[] = PROFESSION_LOCAL_AXES,
): readonly ProfessionLocalAxis[] {
  return registry.filter((a) => a.profession === profession);
}

/**
 * Project a vector that MAY contain this profession's local axes onto the pure
 * spine. Spine axes pass through; a local axis contributes its weight to each
 * spine axis it declares, split evenly so a demotion/roll-up can never amplify a
 * principle beyond its authored magnitude. Sign is preserved, so a cost axis
 * stays a cost after roll-up. A namespaced key that is not a known local axis
 * for this profession is dropped rather than invented — mirroring
 * projectVectorOntoSpine's treatment of non-dimension keys.
 *
 * Kept parallel to (not merged into) projectVectorOntoSpine: that function is
 * the spine-only roll-up used everywhere; this one is the profession-aware
 * superset used when a caller scored local axes.
 */
export function projectLocalAxisVector(
  profession: string,
  vector: Record<string, number>,
  registry: readonly ProfessionLocalAxis[] = PROFESSION_LOCAL_AXES,
): Record<string, number> {
  const localByKey = new Map(
    localAxesFor(profession, registry).map((a) => [a.key, a] as const),
  );
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => {
    out[k] = (out[k] ?? 0) + v;
  };
  for (const [key, value] of Object.entries(vector)) {
    // A bare spine axis passes through unchanged.
    if (isPrincipleDimension(key)) {
      add(key, value);
      continue;
    }
    // A namespaced local axis for this profession rolls up onto its targets.
    const axis = localByKey.get(key);
    if (!axis) continue; // unknown key: drop, do not invent an axis
    const share = value / axis.projectsOnto.length;
    for (const target of axis.projectsOnto) add(target, share);
  }
  return out;
}

/**
 * Structural invariants the type system cannot express. Called by the registry
 * test so a bad axis fails CI rather than silently degrading a decision. The
 * profession set is passed in (not read from disk) so this module stays
 * filesystem-free for the browser bundle — same contract as
 * assertDimensionScopeIntegrity.
 */
export function assertProfessionLocalAxisIntegrity(
  knownProfessions: ReadonlySet<string>,
  registry: readonly ProfessionLocalAxis[] = PROFESSION_LOCAL_AXES,
): void {
  const seen = new Set<string>();
  for (const axis of registry) {
    if (!knownProfessions.has(axis.profession)) {
      throw new Error(
        `Profession-local axis "${axis.key}" is owned by "${axis.profession}", ` +
          `which is not a professionKey in docs/professions/registry.json. An axis ` +
          `owned by a profession that does not exist can never be retrieved.`,
      );
    }
    // Key must be namespaced under its owning profession.
    const expectedPrefix = `${axis.profession}/`;
    if (!axis.key.startsWith(expectedPrefix) || axis.key.length <= expectedPrefix.length) {
      throw new Error(
        `Profession-local axis "${axis.key}" must be namespaced as ` +
          `"${axis.profession}/<axis>". A bare key would collide with the spine.`,
      );
    }
    // A local axis MUST NOT shadow a spine axis name, even namespaced.
    const bare = axis.key.slice(expectedPrefix.length);
    if (isPrincipleDimension(bare)) {
      throw new Error(
        `Profession-local axis "${axis.key}" reuses the spine axis name "${bare}". ` +
          `Score the spine axis directly rather than shadowing it per-profession.`,
      );
    }
    if (seen.has(axis.key)) {
      throw new Error(`Duplicate profession-local axis key "${axis.key}".`);
    }
    seen.add(axis.key);

    if (!axis.highMeans.trim()) {
      throw new Error(`Profession-local axis "${axis.key}" has no highMeans statement.`);
    }
    if (!axis.source.trim()) {
      throw new Error(
        `Profession-local axis "${axis.key}" has no source. The WSID provenance ` +
          `invariant applies unchanged: an unsourced axis cannot publish.`,
      );
    }
    if (axis.projectsOnto.length === 0) {
      throw new Error(
        `Profession-local axis "${axis.key}" declares no projection. A local axis ` +
          `without a spine projection vanishes from every cross-profession decision.`,
      );
    }
    for (const target of axis.projectsOnto) {
      if (!(PRINCIPLE_DIMENSIONS as readonly string[]).includes(target)) {
        throw new Error(
          `Profession-local axis "${axis.key}" projects onto "${target}", which is ` +
            `not a registered dimension.`,
        );
      }
      if (!isSpineDimension(target)) {
        throw new Error(
          `Profession-local axis "${axis.key}" projects onto "${target}", which is ` +
            `itself profession-local. Projections must terminate on the spine in one hop.`,
        );
      }
    }
  }
}
