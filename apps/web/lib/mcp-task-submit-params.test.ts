import { describe, expect, it } from "vitest";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";

const request = {
  agentId: "AGT-WS-EA", routeContext: "/build", title: "Review original design",
  objective: "Review original design", prompt: "Review original design",
  idempotencyKey: "initiative-readiness:BI-TEST:architecture-review", riskClass: "bounded-write",
  authorityScope: ["backlog-item:BI-TEST", "tool:read_source_at_version", "tool:record_initiative_architecture_review"],
  initiativeReviewBinding: {
    itemId: "BI-TEST", gate: "architecture-review", writerToolName: "record_initiative_architecture_review",
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) },
    workroomRef: { kind: "workroom-head", workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) },
  },
};
const recovery = {
  taskRunId: "TR-MCP-original-review", requestDigest: "c".repeat(64),
  expectedUpdatedAt: "2026-10-13T18:00:00.053Z",
};

describe("explicit original-review recovery request", () => {
  it("retains the exact recovery target without changing immutable request identity", () => {
    const original = parseRemoteTaskSubmitParams(request);
    const parsed = parseRemoteTaskSubmitParams({ ...request, reviewRecovery: recovery });
    expect(parsed).toMatchObject({ reviewRecovery: recovery });
    if (typeof parsed === "string" || typeof original === "string") throw Error("valid request refused");
    expect(remoteTaskRequestDigest(parsed)).toBe(remoteTaskRequestDigest(original));
  });

  it.each([
    null, {}, { ...recovery, taskRunId: "" }, { ...recovery, taskRunId: "TR-GATE-other" },
    { ...recovery, requestDigest: "not-a-digest" }, { ...recovery, expectedUpdatedAt: "yesterday" },
    { ...recovery, expectedUpdatedAt: "2026-02-30T18:00:00.000Z" },
    { ...recovery, authorityKey: "oauth-family:forced" },
  ])("refuses malformed or caller-supplied authority controls before new-task creation: %j", reviewRecovery => {
    expect(parseRemoteTaskSubmitParams({ ...request, reviewRecovery })).toEqual(expect.stringContaining("reviewRecovery"));
  });

  it("requires a bound review and exact Workroom for explicit recovery", () => {
    expect(parseRemoteTaskSubmitParams({ ...request, initiativeReviewBinding: undefined, reviewRecovery: recovery }))
      .toEqual(expect.stringContaining("reviewRecovery"));
    expect(parseRemoteTaskSubmitParams({ ...request, initiativeReviewBinding: { ...request.initiativeReviewBinding, workroomRef: undefined }, reviewRecovery: recovery }))
      .toEqual(expect.stringContaining("reviewRecovery"));
  });
});

describe("external independent review writer binding", () => {
  it.each(["design", "architecture", "data", "ux", "security", "compliance", "domain", "archetype", "post_implementation"])("requires an immutable binding for an explicit %s writer", name => {
    expect(parseRemoteTaskSubmitParams({ ...request, initiativeReviewBinding: undefined,
      authorityScope: [`tool:record_initiative_${name}_review`] }))
      .toEqual(expect.stringContaining("initiativeReviewBinding"));
  });
  it("checks writer scopes beyond the tool attachment limit", () => {
    expect(parseRemoteTaskSubmitParams({ ...request, initiativeReviewBinding: undefined,
      authorityScope: ["tool:a", "tool:b", "tool:c", "tool:d", "tool:record_initiative_design_review"] }))
      .toEqual(expect.stringContaining("initiativeReviewBinding"));
  });
  it.each([undefined, [], ["tool:read_source_at_version"], ["tool:record_workroom_evidence"], ["tool:record_initiative_evidence"]])("preserves ordinary unbound work with scope %j", authorityScope => {
    expect(parseRemoteTaskSubmitParams({ ...request, initiativeReviewBinding: undefined, authorityScope })).toMatchObject({ agentId: request.agentId });
  });
});
