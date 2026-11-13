import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tool-types";
type ToolContext = Parameters<typeof actor>[1];
import { workCapsuleActor as actor } from "./handler-actor";

/** BI-53BED66C: the room's own executor queues its gated PR into the merge queue. */
export async function queueWorkroomPullRequestTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const [{ queueWorkroomPullRequest }, github, readiness, { resolveEvidenceByIds }] = await Promise.all([
    import("./queue-workroom-pr"),
    import("@/lib/contributor-change-lanes/github-rest-reader"),
    import("@/lib/build/github-pr-readiness"),
    import("@/lib/change-review/failure-analysis-evidence"),
  ]);
  const token = await github.resolveGithubToken(prisma as never, { preferRepositoryController: true });
  if (!token) return { success: false, error: "github_credential_unavailable", message: "No repository credential is configured to queue the PR. Nothing was queued." };
  const repo = await github.resolveRepoIdentity(prisma as never);
  const caller = await actor(userId, context);
  return queueWorkroomPullRequest(params, {
    db: prisma as never,
    actor: caller,
    assistantMayAct: async (workroomId) => {
      if (!caller.agentId) return false;
      const { resolveAgentWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
      return (await resolveAgentWorkroomAccess({ userId, agentId: caller.agentId, workroomId, requested: "action" })).decision.level === "action";
    },
    resolveGateEvidence: resolveEvidenceByIds,
    observePr: ({ prNumber }) => readiness.observeGithubPullRequest({ owner: repo.owner, repo: repo.name, prNumber, token }),
    enableAutoMerge: ({ nodeId, expectedHeadOid }) => readiness.enablePullRequestAutoMerge({ nodeId, token, expectedHeadOid }),
  });
}
