import {
  buildArchetypeJobDefinitions,
  type ArchetypeJobDefinition,
} from "@dpf/db/archetype-job-definition-projection";
import { JOB_DEFINITION_AXES, type JobDefinitionAxis } from "@dpf/db/coworker-job-definition";
import type { OperationalValueStream } from "@dpf/storefront-templates";

/**
 * Converge the org's JOB definitions at deploy and on upgrade.
 *
 * THE DEFECT THIS CLOSES. `buildArchetypeJobDefinitions` has been pure, tested
 * and exported since its slice landed — and had ZERO callers. Its two siblings
 * are wired: the value-stream projection compiles the OVSM into the EA canvas at
 * storefront setup, on archetype-reset and in the boot backfill. The job
 * projection was in none of them, so a new install derived no job definitions
 * and an upgrade re-seeded none. The goal this substrate exists for — "priming,
 * and tailoring to the specific archetype and specific local or other context
 * when implemented on a new instance through initial deploy, or upgrade" — was
 * unreachable, not because the derivation was missing but because nothing called
 * it.
 *
 * NOTHING IS PERSISTED, AND THAT IS THE RULING. The alternative designs were a
 * new CoworkerJobDefinition table, projection into AgentPromptContext, and
 * EaElement business-role rows. Scored through the kernel
 * (job-definition-convergence, platform-development, elevated): derive-on-read
 * won at composite 8.52 with margin 0.80, high confidence, autonomy-eligible.
 * The OVSM is ALREADY the per-org source of truth and already overridable, so a
 * stored copy would be a second home for a fact the archetype layer owns, and
 * would need its own staleness story on every archetype change.
 *
 * WHAT CONVERGES, THEN, IS THE WORKLIST. At each of those three moments this
 * answers: which roles does this organisation's value stream actually imply,
 * which of the nine axes can be derived for each, which are left UNANSWERED, and
 * what priming each role's own stages require. An axis the OVSM cannot speak to
 * is reported unanswered rather than filled — the contract's whole point is that
 * unanswered is visible.
 *
 * WHERE IT STOPS, DELIBERATELY. The derived `requiredContext` is returned but
 * NOT written onto any coworker's prompt context. Doing that needs a mapping
 * from an archetype role NAME ("Bookkeeper", as the value stream names it) to a
 * canonical AGT-* identity, and no such mapping exists. Inventing one here would
 * bind priming to the wrong coworker silently, which is worse than leaving the
 * payload to the establishment door that already knows which identity it is
 * establishing.
 *
 * Pure and DB-free, so it is asserted without a database.
 *
 * Design: docs/superpowers/specs/2026-09-16-coworker-job-definition-and-establishment-contract-design.md §4, §6 slices 3-4
 */

/** One role's unanswered axes, as the job questions an operator still owes. */
export interface JobDefinitionOpenItem {
  role: string;
  openAxes: JobDefinitionAxis[];
  /** What this role must know before its first turn, derived from its own stages. */
  requiredContext: ArchetypeJobDefinition["requiredContext"];
  hasStandingWork: boolean;
}

export interface JobDefinitionConvergence {
  archetypeId: string;
  archetypeName: string;
  /** Roles the organisation's value stream implies. */
  roles: number;
  /** Of those, how many own standing (repeating) work. */
  rolesWithStandingWork: number;
  /** Count of unanswered axes across every role, by axis. */
  openByAxis: Partial<Record<JobDefinitionAxis, number>>;
  /** Roles carrying at least one unanswered axis, worst first. */
  open: JobDefinitionOpenItem[];
  /**
   * Stages the archetype declares with no responsible role. Work the business
   * does with no answer to who does it — a finding, not a blank.
   */
  unownedStageKeys: string[];
}

/**
 * Derive this archetype's job definitions and reduce them to the worklist.
 *
 * `satisfied` and `waived` both count as answered; anything else — including an
 * axis the projection never returned — is open, because an axis nobody answered
 * and an axis nobody mentioned are the same gap to whoever has to close it.
 */
export function convergeJobDefinitions(ovsm: OperationalValueStream): JobDefinitionConvergence {
  const set = buildArchetypeJobDefinitions(ovsm);
  const openByAxis: Partial<Record<JobDefinitionAxis, number>> = {};
  const open: JobDefinitionOpenItem[] = [];

  for (const definition of set.definitions) {
    const openAxes = JOB_DEFINITION_AXES.filter((axis) => {
      const state = definition.axes[axis]?.state;
      return state !== "satisfied" && state !== "waived";
    });
    for (const axis of openAxes) openByAxis[axis] = (openByAxis[axis] ?? 0) + 1;
    if (openAxes.length > 0) {
      open.push({
        role: definition.role,
        openAxes: [...openAxes],
        requiredContext: definition.requiredContext,
        hasStandingWork: definition.hasStandingWork,
      });
    }
  }

  // Worst first, then by role so the order is stable across runs — a worklist
  // that reorders itself between deploys reads as churn.
  open.sort((a, b) => b.openAxes.length - a.openAxes.length || a.role.localeCompare(b.role));

  return {
    archetypeId: set.archetypeId,
    archetypeName: set.archetypeName,
    roles: set.definitions.length,
    rolesWithStandingWork: set.definitions.filter((d) => d.hasStandingWork).length,
    openByAxis,
    open,
    unownedStageKeys: set.unownedStageKeys,
  };
}

/** One compact line per convergence, so a deploy or upgrade leaves a trail. */
export function formatJobDefinitionConvergence(c: JobDefinitionConvergence): string {
  const axes = Object.entries(c.openByAxis)
    .sort((a, b) => b[1] - a[1])
    .map(([axis, count]) => `${count} ${axis}`)
    .join(", ");
  return (
    `[job-definitions] ${c.archetypeId}: ${c.roles} role(s) derived, `
    + `${c.rolesWithStandingWork} with standing work`
    + (axes ? `; open axes — ${axes}` : "; every derivable axis answered")
    + (c.unownedStageKeys.length > 0
      ? `; ${c.unownedStageKeys.length} stage(s) name no responsible role`
      : "")
  );
}
