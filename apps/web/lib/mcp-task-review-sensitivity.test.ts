import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ token: vi.fn(), authorize: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { mcpApiToken: { findUnique: mocks.token } } }));
vi.mock("./mcp/independent-review-request", () => ({ authorizeCoworkerRequest: mocks.authorize }));
import { remoteReviewSensitivity } from "./mcp-task-review-sensitivity";

const parsed = {
  agentId: "AGT-REVIEWER", routeContext: "/build", title: "Review design",
  objective: "Review immutable platform design", prompt: "Review immutable platform design",
  idempotencyKey: "original-key", riskClass: "bounded-write" as const, collaborationKind: "handoff" as const,
  authorityScope: ["backlog-item:BI-X", "tool:read_source_at_version", "tool:record_initiative_design_review"],
  initiativeReviewBinding: { writerToolName: "record_initiative_design_review", itemId: "BI-X", gate: "design-spec",
    artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "design.md", providerBlobId: "b".repeat(40) } },
};
const token = { tokenId: "access", userId: "human", source: "oauth" as const, capability: "write" as const };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR", scopes: ["initiative_evidence_write"] });
  mocks.authorize.mockResolvedValue({ bounded: true });
});
describe("remote review activity classification", () => {
  it("requires current canonical source-only proof rather than binding presence", async () => {
    expect(await remoteReviewSensitivity(parsed, token, "confidential")).toBe("development");
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ requestKey: "original-key", objective: parsed.objective }),
      "human", expect.objectContaining({ agentId: "AGT-AUTHOR", tokenGrantScopes: ["initiative_evidence_write"] }), { sourceOnly: true });
  });
  it.each(["post-implementation-review", "objective-mapping", "unknown"])("retains classification for %s", async (gate) => {
    expect(await remoteReviewSensitivity({ ...parsed, initiativeReviewBinding: { ...parsed.initiativeReviewBinding, gate } }, token, "confidential")).toBe("confidential");
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it.each([{ bounded: true, refusal: { success: false } }, { bounded: false }])("does not classify refused or general delegation as source-only", async (result) => {
    mocks.authorize.mockResolvedValue(result);
    expect(await remoteReviewSensitivity(parsed, token, "confidential")).toBe("confidential");
  });
  it("retains restricted residency and rejects extra prompt content", async () => {
    expect(await remoteReviewSensitivity(parsed, token, "restricted")).toBe("restricted");
    expect(await remoteReviewSensitivity({ ...parsed, prompt: "additional customer evidence" }, token, "confidential")).toBe("confidential");
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("fails closed on missing proof or unavailable validation", async () => {
    mocks.token.mockResolvedValue(null);
    expect(await remoteReviewSensitivity(parsed, token, "confidential")).toBe("confidential");
    mocks.token.mockRejectedValue(new Error("unavailable"));
    expect(await remoteReviewSensitivity(parsed, token, "confidential")).toBe("confidential");
  });
});
