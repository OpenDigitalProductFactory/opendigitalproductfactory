import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";
import {
  projectArchetypeValueStream,
  type ProjectArchetypeValueStreamInput,
} from "@dpf/db/archetype-value-stream-projection";
import {
  convergeJobDefinitions,
  formatJobDefinitionConvergence,
  type JobDefinitionConvergence,
} from "./converge-job-definitions";
import { getErrorMessage } from "@/lib/shared/get-error-message";

type Db = ProjectArchetypeValueStreamInput["db"];

/**
 * App-layer orchestration for P0 "Capture": resolve the template archetype,
 * derive its Operational Value Stream Model, and project it into the EA
 * substrate. Called from storefront setup (with the package Prisma client) and
 * from archetype-reset (with the reset transaction, so the projection commits or
 * rolls back atomically with the rest of the reset).
 *
 * JOB DEFINITIONS CONVERGE HERE, not at the call sites. The OVSM is derived
 * exactly once, in this function, and all three convergence moments — storefront
 * setup, archetype-reset and the boot backfill — reach it through this door. So
 * the job worklist is derived wherever the value stream is, by construction.
 *
 * That placement is the point. The job projection existed with zero callers
 * precisely because wiring it meant remembering three separate sites; a fourth
 * would have been added and one of the three forgotten, which is the same
 * one-of-N-call-sites defect this codebase has produced repeatedly. One seam
 * cannot be half-wired.
 */
export async function projectOperationalValueStreamForArchetype(input: {
  db?: Db;
  organizationId: string;
  archetypeId: string;
}) {
  const template = ALL_ARCHETYPES.find((a) => a.archetypeId === input.archetypeId);
  if (!template) {
    throw new Error(`Template archetype ${input.archetypeId} not found in ALL_ARCHETYPES`);
  }
  const ovsm = deriveOperationalValueStream(template);
  const projected = await projectArchetypeValueStream({
    db: input.db,
    orgId: input.organizationId,
    ovsm,
  });

  // Derive-on-read, never stored (kernel: job-definition-convergence, composite
  // 8.52, margin 0.80, high confidence). The OVSM already owns these facts per
  // org and is already overridable, so a stored copy would be a second home with
  // its own staleness problem on every archetype change.
  //
  // NON-FATAL, unlike the value-stream projection above. Setup has not met the
  // architecture contract without the EA view, so that throws; a job worklist is
  // a REPORT, and failing an install because a report could not be computed
  // would trade a real outcome for an advisory one.
  let jobDefinitions: JobDefinitionConvergence | null = null;
  try {
    jobDefinitions = convergeJobDefinitions(ovsm);
    console.info(formatJobDefinitionConvergence(jobDefinitions));
  } catch (err) {
    console.warn(
      "[job-definitions] convergence could not be computed — the value stream projected, so "
        + "this is a report that is missing, not an install that is wrong",
      { archetypeId: input.archetypeId, error: getErrorMessage(err) },
    );
  }

  return { ...projected, jobDefinitions };
}
