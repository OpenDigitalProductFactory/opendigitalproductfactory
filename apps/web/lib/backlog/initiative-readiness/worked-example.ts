import type { ArtifactRefInputDeps } from "@/lib/backlog/initiative-readiness/artifact-ref-input";
import type { InitiativeReadinessLane } from "@/lib/tak/initiative-readiness-tool-grants";
import { ok } from "@/lib/shared/action-result";
import { workedCall } from "@/lib/work-capsules/source-commit-resolution";

/**
 * BI-DF34D948: every initiative-readiness writer shows one complete call in its
 * description, and every refusal it returns ends with the caller's own call,
 * corrected. A refusal that only names the rule cost a retry per reading.
 */
export function initiativeWorkedExample(toolName: string, lane: InitiativeReadinessLane): string {
  const gate = lane.gates.includes("research") ? "research" : lane.gates[0];
  return workedCall(toolName, {
    itemId: "BI-XXXXXXXX",
    gate,
    decision: "pass",
    artifactRef: { path: "docs/superpowers/specs/2026-10-28-example-design.md", headSha: "<pushed head, full or 7+ character prefix>" },
    reason: "What was verified, citing the artifact.",
    findings: [],
    resolvedFindingRefs: [],
  });
}

/** "Retry: tool({...caller's args, ...correction})". */
export function initiativeRetry(toolName: string, params: Record<string, unknown>, correction: Record<string, unknown>): string {
  return `Retry: ${workedCall(toolName, { ...params, ...correction })}`;
}

export async function defaultArtifactRefInputDeps(): Promise<ArtifactRefInputDeps> {
  const [{ prisma }, reader, repository, provider] = await Promise.all([
    import("@dpf/db"),
    import("@/lib/contributor-change-lanes/github-rest-reader"),
    import("@/lib/backlog/initiative-readiness/repository-artifact"),
    import("@/lib/work-capsules/source-commit-provider"),
  ]);
  return {
    canonicalRepositoryFullName: async () => {
      const repo = await reader.resolveRepoIdentity(prisma as never);
      return `${repo.owner}/${repo.name}`;
    },
    commitDeps: (repositoryFullName) => ({
      lookupProviderCommit: provider.providerCommitLookup({ db: prisma as never, repositoryFullName }),
      recordedCandidates: provider.recordedWorkroomCommits(prisma as never),
    }),
    readBlobId: async (args) => {
      const blob = await repository.readRepositoryProviderBlob(args);
      return blob.ok ? ok({ blobId: blob.blobId }) : { ok: false, code: blob.code, error: blob.error };
    },
  };
}
