// apps/web/lib/build/build-start-approval.ts
//
// The Approve Start precondition, in one place (BI-BDB63485). A Build Studio
// build that came from a backlog item (`originatingBacklogItemId`) must have its
// draft approved (`draftApprovedAt`) before it moves ideate → plan or
// plan → build. It is a caller check before the phase gates on every path that
// owns those transitions: advanceBuildPhase (lib/actions/build.ts), the admin
// advance route (app/api/agent/build/advance-phase/route.ts) and the
// save_phase_handoff auto-advance (lib/mcp/packs/build-evidence-extra-pack.ts).
//
// A dependency leaf: no imports, so the MCP tool-pack graph can use it without
// joining apps/web's import cycle.

export type BuildStartApprovalSubject = {
  originatingBacklogItemId: string | null;
  draftApprovedAt: Date | string | null;
};

/** True when this transition is held until the operator records Approve Start. */
export function requiresBuildStartApproval(
  build: BuildStartApprovalSubject,
  currentPhase: string,
  targetPhase: string,
): boolean {
  return build.originatingBacklogItemId != null
    && build.draftApprovedAt == null
    && (
      (currentPhase === "ideate" && targetPhase === "plan")
      || (currentPhase === "plan" && targetPhase === "build")
    );
}

/** The operator-facing refusal for a transition held by Approve Start. */
export function buildStartApprovalRefusal(currentPhase: string): string {
  return currentPhase === "ideate"
    ? "Approve Start before moving this governed backlog draft into planning."
    : "Approve Start before moving this backlog-linked draft into implementation.";
}
