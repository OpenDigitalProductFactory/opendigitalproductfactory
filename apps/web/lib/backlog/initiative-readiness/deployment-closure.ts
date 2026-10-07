import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseVerifiedPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { isDocPullRequest } from "@/lib/backlog/pr-submit-awaiting-acceptance";
import type { InitiativeReadinessDecision } from "./types";

const sha = /^[a-f0-9]{40}$/i;
const exec = promisify(execFile);
export type DeploymentClosureProof = {
  kind: "deployed";
  runId: string;
  repositoryFullName: string;
  pullRequestNumber: number;
  headSha: string;
  mergeCommitSha: string;
  targetSha: string;
  servedSha: string;
  completedAt: string;
};
export type DeploymentClosureResult = DeploymentClosureProof | { kind: "unavailable"; reason: string };
type Room = { repositoryFullName: string | null; headSha: string | null; pullRequestNumber: number | null };
type Run = { runId: string; status: string; dryRun: boolean; targetSha: string | null; deployedSha: string | null; completedAt: Date | null };

/** Only immutable provider/deployment facts can authorize delivery closure. */
export async function resolveDeploymentClosureProof(args: {
  workType: string | null;
  room: Room | null;
  run: Run | null;
  servedSha: string | null;
  observation: unknown;
  contains: (repository: string, ancestor: string, target: string) => Promise<boolean | null>;
}): Promise<DeploymentClosureResult> {
  const { room, run, servedSha } = args;
  const pr = parseVerifiedPullRequestObservation(args.observation);
  if (!room || !run || run.status !== "succeeded" || run.dryRun || !run.completedAt
    || !servedSha || !sha.test(servedSha) || !run.deployedSha || !sha.test(run.deployedSha)
    || servedSha.toLowerCase() !== run.deployedSha.toLowerCase()
    || !run.targetSha || !sha.test(run.targetSha)) {
    return { kind: "unavailable", reason: "No successful canonical deployment matches the served image." };
  }
  if (!pr || pr.state !== "merged" || pr.isDraft || !pr.mergeCommitSha
    || (isDocPullRequest(pr.title) && args.workType !== "doc")
    || room.repositoryFullName !== pr.repositoryFullName || room.pullRequestNumber !== pr.number
    || !room.headSha || room.headSha.toLowerCase() !== pr.headSha.toLowerCase()
    || Date.parse(pr.mergedAt!) > run.completedAt.getTime()) {
    return { kind: "unavailable", reason: "No verified merged pull request matches the current delivery attempt." };
  }
  const included = await args.contains(pr.repositoryFullName, pr.mergeCommitSha, run.targetSha);
  if (included !== true) return { kind: "unavailable", reason: included === false
    ? "The merged pull request is not included in the deployed lineage."
    : "Deployed lineage membership could not be verified." };
  return { kind: "deployed", runId: run.runId, repositoryFullName: pr.repositoryFullName,
    pullRequestNumber: pr.number, headSha: pr.headSha, mergeCommitSha: pr.mergeCommitSha,
    targetSha: run.targetSha, servedSha, completedAt: run.completedAt.toISOString() };
}

/** Server-owned reads; a caller cannot submit a deployment assertion as proof. */
export async function resolveBacklogDeploymentClosure(args: { itemId: string; workType: string | null; roots: string[] }): Promise<DeploymentClosureResult> {
  try {
    const { prisma } = await import("@dpf/db");
    const { getDeployedSha } = await import("@/lib/self-upgrade/completion");
    const { isReachableFromTrunk } = await import("@/lib/work-capsules/git-scanner");
    // Newest attempt wins: an old merged PR cannot close newly reopened work.
    const room = await prisma.workroom.findFirst({ where: { backlogItemId: args.itemId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { repositoryFullName: true, headSha: true, pullRequestNumber: true } });
    const servedSha = await getDeployedSha();
    if (!room?.pullRequestNumber || !servedSha || !sha.test(servedSha)) {
      return { kind: "unavailable", reason: "Current delivery attempt or served identity is unavailable." };
    }
    const run = await prisma.selfUpgradeRun.findFirst({
      where: { status: "succeeded", dryRun: false, deployedSha: { equals: servedSha, mode: "insensitive" } },
      orderBy: { completedAt: "desc" },
    });
    const snapshots = await prisma.contributorInventorySnapshot.findMany({
      where: { source: "github-pr", sourceKey: String(room.pullRequestNumber) },
      orderBy: { fetchedAt: "desc" }, take: 20, select: { payload: true },
    });
    const observation = snapshots.map(row => parseVerifiedPullRequestObservation(row.payload))
      .find(pr => pr?.repositoryFullName === room.repositoryFullName);
    return await resolveDeploymentClosureProof({ workType: args.workType, room, run, servedSha, observation,
      contains: async (repository, ancestor, target) => {
        for (const root of args.roots) {
          try {
            const { stdout } = await exec("git", ["-C", root, "remote", "get-url", "origin"], { timeout: 5000 });
            const remote = stdout.trim().replace(/\.git$/, "");
            if (remote !== `https://github.com/${repository}` && remote !== `git@github.com:${repository}`) continue;
            const answer = await isReachableFromTrunk(root, ancestor, target);
            if (answer !== null) return answer;
          } catch { /* An unavailable checkout is not negative evidence. */ }
        }
        return null;
      },
    });
  } catch {
    return { kind: "unavailable", reason: "Canonical deployment evidence could not be read." };
  }
}

/** Acceptance remains an independent obligation, never a fabricated pass. */
export function projectDeploymentClosure(decision: InitiativeReadinessDecision, proof: DeploymentClosureProof): InitiativeReadinessDecision {
  const separate = (code: string) => code === "ACCEPTANCE_EVIDENCE_REQUIRED" || code === "OBJECTIVE_RECONCILIATION_REQUIRED";
  const acceptance = [...decision.satisfied, ...decision.unmet, ...decision.blockers].filter(row => separate(row.code));
  const blockers = decision.blockers.filter(row => !separate(row.code));
  const unmet = decision.unmet.filter(row => !separate(row.code));
  return { ...decision, blockers, unmet,
    satisfied: [...decision.satisfied.filter(row => !separate(row.code)), ...acceptance.map(row => row.state === "pass" ? row : ({
      ...row, state: "not-applicable" as const,
      nextAction: `Delivery closed on ${proof.runId}; acceptance remains separately recorded and has not been declared passed.`,
    }))],
    verdict: blockers.length ? "denied" : unmet.length ? "input-required" : "allowed",
  };
}
