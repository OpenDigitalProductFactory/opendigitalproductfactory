import { describe, expect, it, vi } from "vitest";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { resolveDeploymentClosureProof } from "./deployment-closure";

const sha = (c: string) => c.repeat(40);
const room = { repositoryFullName: "owner/repo", headSha: sha("a"), pullRequestNumber: 42 };
const run = { runId: "SUR-1", status: "succeeded", dryRun: false, targetSha: sha("c"), deployedSha: sha("d"), completedAt: new Date("2026-10-03T20:00:00Z") };
const observation = createPullRequestObservation({ repositoryFullName: "owner/repo", number: 42, url: "https://github.com/owner/repo/pull/42", title: "fix", headBranch: "fix", headSha: sha("a"), state: "merged", isDraft: false, mergeStateStatus: null, mergeCommitSha: sha("b"), mergedAt: "2026-10-03T19:00:00Z", providerUpdatedAt: "2026-10-03T19:00:00Z", observedAt: "2026-10-03T19:01:00Z" });
const inputs = () => ({ workType: "feature", room, run, servedSha: sha("d"), observation, contains: vi.fn(async () => true as boolean | null) });

describe("canonical deployment closure", () => {
  it("binds repository, PR head, merged commit and immutable served deployment", async () => {
    const args = inputs();
    expect(await resolveDeploymentClosureProof(args)).toMatchObject({ kind: "deployed", runId: "SUR-1", pullRequestNumber: 42, mergeCommitSha: sha("b"), servedSha: sha("d") });
    expect(args.contains).toHaveBeenCalledWith("owner/repo", sha("b"), sha("c"));
  });
  it.each([
    { servedSha: sha("e") },
    { run: { ...run, dryRun: true } },
    { run: { ...run, status: "failed" } },
    { run: { ...run, completedAt: null } },
    { room: { ...room, headSha: sha("e") } },
    { room: { ...room, repositoryFullName: "other/repo" } },
    { room: { ...room, pullRequestNumber: 43 } },
    { observation: { ...observation, state: "open" } },
    { observation: null },
    { observation: createPullRequestObservation({ ...observation, title: "docs: implementation plan" }) },
  ])("rejects missing or mismatched identity %j", async (override) => {
    const args = { ...inputs(), ...override };
    expect((await resolveDeploymentClosureProof(args)).kind).not.toBe("deployed");
    expect(args.contains).not.toHaveBeenCalled();
  });
  it.each([false, null])("does not close when deployed lineage membership is %s", async (answer) => {
    expect((await resolveDeploymentClosureProof({ ...inputs(), contains: async () => answer })).kind).not.toBe("deployed");
  });
});

describe("delivery and acceptance decision separation", () => {
  it("retains authorization and scope blockers while marking acceptance not applicable to delivery", async () => {
    const { projectDeploymentClosure } = await import("./deployment-closure");
    const { readinessRequirement } = await import("./readiness-guidance");
    const proof = await resolveDeploymentClosureProof(inputs());
    if (proof.kind !== "deployed") throw new Error("fixture must prove deployment");
    const acceptance = readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "fail", accountableRole: "acceptance-reviewer" });
    const authorization = readinessRequirement({ code: "AUTHORIZATION_DENIED", state: "fail", accountableRole: "platform-governance" });
    const conflict = readinessRequirement({ code: "OBJECTIVE_BASELINE_CONFLICT", state: "fail", accountableRole: "acceptance-reviewer" });
    const decision = projectDeploymentClosure({ decisionId: "test", policyVersion: "test", subject: { kind: "backlog-item", id: "BI-1" },
      transitionObject: { kind: "backlog-item", id: "BI-1", expectedVersion: "awaiting-acceptance", targetState: "done" },
      profile: "feature", target: "completion", verdict: "denied", satisfied: [], unmet: [], blockers: [acceptance, authorization, conflict], evaluatedAt: new Date().toISOString() }, proof);
    expect(decision.verdict).toBe("denied");
    expect(decision.blockers).toEqual([authorization, conflict]);
    expect(decision.satisfied[0]?.state).toBe("not-applicable");
  });
});
