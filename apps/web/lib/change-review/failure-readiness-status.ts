import { prisma } from "@dpf/db";
import { createGithubReadTransport, resolveGithubToken, resolveRepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { checkWorkroomFailureReadiness } from "./failure-readiness-publication";

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

/** The workflow that checks the published status; matched by path, not display name. */
export const FAILURE_READINESS_WORKFLOW_PATH = ".github/workflows/failure-readiness.yml";

export type FailureReadinessPublication = { rerunRunIds: number[]; rerunError?: string };

/** Publish only the server-resolved verdict for the Workroom's final commit. */
export async function publishFailureReadinessStatus(capsuleId: string): Promise<FailureReadinessPublication> {
  const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { headSha: true, repositoryFullName: true } });
  if (!room?.headSha || !IMMUTABLE_SHA.test(room.headSha)) throw new Error("Failure readiness requires an immutable source commit.");
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
    if (!verdict.mayPublish) return { rerunRunIds: [] };
    // A commit status does not trigger a workflow, and the check normally ran
    // when the PR opened, before this status existed. Re-run its failed runs
    // for this commit so the required check reads the evidence just published.
    // The status is already durable, so a refused re-run is reported, not thrown.
    try {
      return { rerunRunIds: await rerunFailedReadinessChecks(transport.fetch, repository, room.headSha, token) };
    } catch (error) {
      const rerunError = getErrorMessage(error);
      console.warn(`[failure-readiness] status published for ${room.headSha} but the check was not re-run: ${rerunError}`);
      return { rerunRunIds: [], rerunError };
    }
  } finally { await transport.close(); }
}

async function rerunFailedReadinessChecks(
  fetchImpl: typeof fetch, repository: { owner: string; name: string }, headSha: string, token: string,
): Promise<number[]> {
  const base = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/actions/runs`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const listed = await fetchImpl(`${base}?head_sha=${headSha}&status=failure&per_page=100`, { headers });
  if (!listed.ok) throw new Error(`listing workflow runs failed (${listed.status})`);
  const { workflow_runs: runs = [] } = await listed.json() as { workflow_runs?: Array<{ id: number; path?: string; event?: string }> };
  // Merge-group runs check a queue snapshot, not this commit alone; the queue re-runs those itself.
  const ids = runs.filter(run => run.path === FAILURE_READINESS_WORKFLOW_PATH && run.event === "pull_request").map(run => run.id);
  for (const id of ids) {
    const rerun = await fetchImpl(`${base}/${id}/rerun-failed-jobs`, { method: "POST", headers });
    if (!rerun.ok) throw new Error(`re-running workflow run ${id} failed (${rerun.status}); the credential needs Actions write access`);
    await rerun.body?.cancel();
  }
  return ids;
}
