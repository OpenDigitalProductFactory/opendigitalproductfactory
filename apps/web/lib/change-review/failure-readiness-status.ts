import { withConnectRetry } from "@/lib/network/connect-retry";
import { prisma } from "@dpf/db";
import { createGithubReadTransport, resolveGithubToken, resolveRepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import { checkWorkroomFailureReadiness } from "./failure-readiness-publication";
import { FailureReadinessPublicationError } from "./failure-readiness-publication-error";

export { FailureReadinessPublicationError, type FailureReadinessPublicationCode } from "./failure-readiness-publication-error";

export const FAILURE_READINESS_STATUS_CONTEXT = "dpf/failure-readiness";

const IMMUTABLE_SHA = /^[a-f0-9]{40}$/;

/**
 * A commit status can only be published for a Workroom whose final commit is
 * known and lives in a repository. A Build Studio room reaches its semantic
 * review before its branch has been pushed anywhere — no headSha, so no GitHub
 * commit to attach a status to. That is a lifecycle position, not a failure:
 * the ship/PR lane binds the room and publishes then.
 */
export async function isWorkroomStatusPublishable(
  capsuleId: string,
): Promise<{ publishable: true } | { publishable: false; reason: string }> {
  const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { headSha: true, repositoryFullName: true } });
  if (!room?.headSha || !IMMUTABLE_SHA.test(room.headSha)) {
    return { publishable: false, reason: "the Workroom has no immutable source commit yet" };
  }
  if (!room.repositoryFullName) {
    return { publishable: false, reason: "the Workroom is not bound to a repository yet" };
  }
  return { publishable: true };
}

function rateLimited(response: { status: number; headers?: Headers }): boolean {
  if (response.status === 429) return true;
  return response.status === 403 && (response.headers?.get("x-ratelimit-remaining") === "0" || !!response.headers?.get("retry-after"));
}

/**
 * Publish only the server-resolved verdict for the Workroom's final commit.
 * `expectedHeadSha` fences a retained publication to the commit that was
 * reviewed: a room that moved on is refused before any verdict or effect.
 */
export async function publishFailureReadinessStatus(capsuleId: string, options: { expectedHeadSha?: string } = {}): Promise<void> {
  const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { headSha: true, repositoryFullName: true } });
  if (!room?.headSha || !IMMUTABLE_SHA.test(room.headSha)) throw new FailureReadinessPublicationError("no-source-commit", "Failure readiness requires an immutable source commit.");
  if (options.expectedHeadSha && room.headSha.toLowerCase() !== options.expectedHeadSha.toLowerCase()) {
    throw new FailureReadinessPublicationError("source-changed", "Workroom moved off the reviewed commit; its verdict is not published for the new one.");
  }
  const repository = await resolveRepoIdentity(prisma);
  if (room.repositoryFullName !== `${repository.owner}/${repository.name}`) throw new FailureReadinessPublicationError("repository-mismatch", "Failure readiness repository mismatch.");
  const token = await resolveGithubToken(prisma);
  if (!token) throw new FailureReadinessPublicationError("credential-unavailable", "GitHub status publication is unavailable; the required check remains unsatisfied.");
  const verdict = await checkWorkroomFailureReadiness(capsuleId);
  if (verdict.mayPublish && verdict.sourceHeadSha !== room.headSha) throw new FailureReadinessPublicationError("source-changed", "Workroom changed during status publication; retry with its current identity.");
  const transport = createGithubReadTransport();
  try {
    const response = await withConnectRetry(() => transport.fetch(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/statuses/${room.headSha}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ context: FAILURE_READINESS_STATUS_CONTEXT, state: verdict.mayPublish ? "success" : "failure", description: verdict.reason.slice(0, 140) }),
    }));
    if (!response.ok) {
      await response.body?.cancel();
      throw new FailureReadinessPublicationError("http-status",
        `Failure readiness status publication failed (${response.status}); retry the same committed verdict.`,
        { httpStatus: response.status, rateLimited: rateLimited(response) });
    }
    await response.body?.cancel();
  } finally { await transport.close(); }
}
