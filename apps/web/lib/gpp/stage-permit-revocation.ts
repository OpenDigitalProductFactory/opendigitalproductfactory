// Revoke the permits of the stages a rework leaves.
//
// GPP Phase 3c PR-3c-3 (BI-8875C9DF). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6.2 ("Permit revocation"), §11 correction 10; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-3, stage-permit-revocation.ts). Parent: GPP notation spec §5,
// construct 13 ("permits for the stages left are revoked").
//
// The work-shape drive calls this on every rework transition, with the stages
// of the loop region the token returns across
// (lib/queue/functions/workroom-drive-graph.ts). It goes through the one
// permit store (permit-store.ts), the only module that touches GppPermit.
//
// A HOOK WITH NOTHING TO REVOKE YET. No stage permit is minted on main:
// shadowPermitClaims writes `shapeRef: null` and `stageKey: null`
// (permit-mint.ts), so no permit names a stage and this revokes nothing. It
// becomes real with the binding-attach follow-up, which mints stage-scoped
// permits; until then its test pins that a permit naming a left stage would not
// stay valid.
//
// Fail-open, like every permit write (permit-store.ts): an error is logged and
// the drive's tick continues. A permit is audit evidence and short-lived
// (GPP_PERMIT_TTL_MS), never a precondition the drive depends on.

import { gppPermitStore, type GppPermitStore } from "./permit-store";

export type StagePermitRevocation = {
  /** The workroom the permits were minted under (the room's capsule id, as PermitClaims.workroomId carries it). */
  workroomId: string;
  /** The stages the rework leaves. */
  stageKeys: readonly string[];
  now?: Date;
};

/** Revoke every unrevoked permit for these stages of this workroom. Resolves the number revoked; never throws. */
export async function revokeStagePermits(
  input: StagePermitRevocation,
  store: Pick<GppPermitStore, "revokeStagePermits"> = gppPermitStore(),
): Promise<number> {
  const stageKeys = [...new Set(input.stageKeys.filter((key) => key.trim().length > 0))];
  if (!input.workroomId.trim() || stageKeys.length === 0 || !store.revokeStagePermits) return 0;
  try {
    return await store.revokeStagePermits({ workroomId: input.workroomId, stageKeys, now: input.now ?? new Date() });
  } catch (error) {
    console.error(
      "[gpp-permit] stage permit revocation failed workroom=%s stages=%s: %s",
      JSON.stringify(input.workroomId),
      JSON.stringify(stageKeys),
      error instanceof Error ? JSON.stringify(error.message) : JSON.stringify(String(error)),
    );
    return 0;
  }
}
