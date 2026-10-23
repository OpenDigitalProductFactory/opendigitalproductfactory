// apps/web/lib/build/plan-phase-design-save.ts
//
// saveBuildEvidence redirects a designDoc save made while the build is in plan:
// the coworker meant to save its buildPlan, so the design is left untouched and
// the coworker is told which field to save (the design phase is over).
//
// BI-3E57890E: the design-fix loop is the one legitimate plan-phase design
// writer. When an independent reviewer fails a plan-phase design, the loop
// revises it from the reviewer's findings, and that revision must land as a new
// accepted designDoc revision. Without this exemption the save reported
// success, kept the rejected design, and the reviewer re-read the same bytes.

export function redirectsPlanPhaseDesignSave(args: {
  phase: string | null | undefined;
  field: string;
  /** Set only by the design-fix loop's regeneration (ideate-on-approval.ts). */
  allowPlanPhaseDesignRevision?: boolean;
}): boolean {
  return args.phase === "plan" && args.field === "designDoc" && args.allowPlanPhaseDesignRevision !== true;
}
