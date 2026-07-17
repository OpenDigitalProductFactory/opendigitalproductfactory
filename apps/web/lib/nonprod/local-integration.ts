import type { Prisma } from "@dpf/db";
import { recordExternalEvidence } from "@/lib/actions/external-evidence";

export type LocalIntegrationResultInput = {
  actorUserId: string;
  provider: "build-studio" | "claude" | "codex" | "grok" | "antigravity" | "coworker";
  externalSessionId: string;
  routeContext: string;
  buildId?: string;
  taskRunId?: string;
  candidateBranch: string;
  mode: "single-branch" | "sibling-set" | "post-merge-main";
  // "blocked_sandbox_drift": the shared sandbox's installed dependency graph
  // did not match the lockfile (or was mid-install), so the gate refused to
  // produce product evidence. A sandbox defect, not a product failure (BI-ECDF9520).
  status: "passed" | "failed" | "conflict" | "blocked_sandbox_drift";
  summary: string;
  evidence: Prisma.InputJsonValue;
};

export async function recordLocalIntegrationResult(input: LocalIntegrationResultInput) {
  return recordExternalEvidence({
    actorUserId: input.actorUserId,
    routeContext: input.routeContext,
    operationType: "local_integration_ci",
    target: input.candidateBranch,
    provider: input.provider,
    resultSummary: input.summary,
    buildId: input.buildId,
    taskRunId: input.taskRunId,
    details: {
      externalSessionId: input.externalSessionId,
      mode: input.mode,
      status: input.status,
      evidence: input.evidence,
    } as Prisma.InputJsonValue,
  });
}
