import { prisma } from "@dpf/db";
import { createGithubReadTransport, resolveGithubToken, resolveRepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import { checkWorkroomFailureReadiness } from "./failure-readiness-publication";

export const FAILURE_READINESS_STATUS_CONTEXT = "dpf/failure-readiness";

/** Publish only the server-resolved verdict for the Workroom's final commit. */
export async function publishFailureReadinessStatus(capsuleId: string): Promise<void> {
  const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { headSha: true, repositoryFullName: true } });
  if (!room?.headSha || !/^[a-f0-9]{40}$/.test(room.headSha)) throw new Error("Failure readiness requires an immutable source commit.");
  const repository = await resolveRepoIdentity(prisma);
  if (room.repositoryFullName !== `${repository.owner}/${repository.name}`) throw new Error("Failure readiness repository mismatch.");
  const token = await resolveGithubToken(prisma);
  if (!token) throw new Error("GitHub status publication is unavailable; the required check remains unsatisfied.");
  const verdict = await checkWorkroomFailureReadiness(capsuleId);
  if (verdict.mayPublish && verdict.sourceHeadSha !== room.headSha) throw new Error("Workroom changed during status publication; retry with its current identity.");
  const transport = createGithubReadTransport();
  try {
    const response = await transport.fetch(`https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/statuses/${room.headSha}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ context: FAILURE_READINESS_STATUS_CONTEXT, state: verdict.mayPublish ? "success" : "failure", description: verdict.reason.slice(0, 140) }),
    });
    if (!response.ok) throw new Error(`Failure readiness status publication failed (${response.status}); retry the same committed verdict.`);
    await response.body?.cancel();
  } finally { await transport.close(); }
}
