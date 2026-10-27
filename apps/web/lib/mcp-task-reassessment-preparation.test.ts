import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), tools: vi.fn(), model: vi.fn(), profile: vi.fn(), pir: vi.fn(), sensitivity: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { agentModelConfig: { findUnique: mocks.model } } }));
vi.mock("./tak/autonomous-work-run", () => ({ resolveAutonomousWorkAgent: mocks.agent, resolveAutonomousWorkTools: mocks.tools }));
vi.mock("./backlog/initiative-readiness/reviewer-profile", () => ({ loadReviewerProfile: mocks.profile }));
vi.mock("./pir-evidence-context", () => ({ loadPirEvidenceContext: mocks.pir }));
vi.mock("./mcp-task-review-sensitivity", () => ({ remoteReviewSensitivity: mocks.sensitivity }));
vi.mock("./routing/model-successor", () => ({ lookupPinnedModelFamily: vi.fn(async () => "current-family") }));
import { prepareRemoteReviewAttempt, preparePresentReassessmentInput } from "./mcp-task-reassessment-preparation";
const binding = { writerToolName: "record_initiative_design_review", itemId: "BI-285EF102", gate: "design-spec",
  artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) } };
const parsed = { agentId: "AGT-WS-REVIEW", routeContext: "/build", title: "Review", objective: "Full independent review", prompt: "Full independent review",
  idempotencyKey: "issued", riskClass: "bounded-write" as const, collaborationKind: "handoff" as const,
  authorityScope: ["backlog-item:BI-285EF102", "tool:read_source_at_version", "tool:record_initiative_design_review"], initiativeReviewBinding: binding };
const human = { userId: "human", platformRole: "admin", isSuperuser: true };
const ports = { resolveAgent: mocks.agent, resolveTools: mocks.tools }, sensitivityPort = { resolveSensitivity: mocks.sensitivity };
const schemas = ["read_source_at_version", binding.writerToolName].map(name => ({ name, description: name, inputSchema: { type: "object", properties: {} },
  requiredCapability: null, sideEffect: name === binding.writerToolName, executionMode: "immediate" }));
function configure() {
  mocks.agent.mockResolvedValue({ agentId: "ws-review", displayName: "Review", systemPrompt: "Complete persona", sensitivity: "internal" });
  mocks.tools.mockResolvedValue({ tools: schemas, toolsForProvider: schemas.map(tool => ({ type: "function", function: { name: tool.name, parameters: tool.inputSchema } })), deferredTools: [] });
  mocks.model.mockResolvedValue({ minimumTier: "strong", budgetClass: "quality_first", pinnedProviderId: "operator-provider", pinnedModelId: "operator-model",
    minimumContextTokens: 16000, minimumCapabilities: { toolUse: true }, residencyPolicy: "approved_cloud" });
  mocks.pir.mockResolvedValue("All review criteria"); mocks.sensitivity.mockResolvedValue("internal");
}
function engagementRequest() {
  return { ...parsed, agentId: "ux-design-critic", initiativeReviewBinding: undefined,
    authorityScope: ["tool:read_source_at_version"],
    engagementBinding: { version: 1 as const, engagementId: "CE-merge-proof", offerId: "offer-ux", serviceId: "service-ux",
      providerAgentId: "ux-design-critic", actorAgentId: "AGT-EXT-CODEX", userId: "human", workroomId: "WC-merge-proof",
      stageKey: "review", inputDigest: "d".repeat(64), artifactRef: binding.artifactRef } };
}
describe("one shared remote review preparation", () => {
  it("preserves an engagement's registered runtime provider identity", async () => {
    configure();
    mocks.agent.mockResolvedValue({ agentId: "ux-design-critic", systemPrompt: "Complete persona", sensitivity: "internal" });
    const turn = await prepareRemoteReviewAttempt({ parsed: engagementRequest(), userContext: human, restricted: false }, ports);
    expect(turn.resolvedAgentId).toBe("ux-design-critic");
    expect(mocks.tools).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: "ux-design-critic" }));
  });
  it("refuses an unrelated engagement provider before resolving any tools", async () => {
    configure(); mocks.tools.mockClear();
    mocks.agent.mockResolvedValue({ agentId: "unrelated-provider", systemPrompt: "Other persona", sensitivity: "internal" });
    await expect(prepareRemoteReviewAttempt({ parsed: engagementRequest(), userContext: human, restricted: false }, ports))
      .rejects.toThrow("Engagement provider identity changed during runtime resolution.");
    expect(mocks.tools).not.toHaveBeenCalled();
  });
  it("limits every engagement tool attachment lane to its exact admitted names", async () => {
    configure();
    mocks.agent.mockResolvedValue({ agentId: "ux-design-critic", systemPrompt: "Complete persona", sensitivity: "internal" });
    mocks.tools.mockResolvedValue({ tools: schemas, toolsForProvider: [
      { type: "function", function: { name: schemas[0].name, parameters: schemas[0].inputSchema } },
      { type: "function", name: schemas[1].name, parameters: schemas[1].inputSchema },
    ], deferredTools: [schemas[1]] });
    const turn = await prepareRemoteReviewAttempt({ parsed: engagementRequest(), userContext: human, restricted: false }, ports);
    expect(turn.tools.tools.map(tool => tool.name)).toEqual(["read_source_at_version"]);
    expect(turn.tools.toolsForProvider).toEqual([{ type: "function", function: { name: schemas[0].name, parameters: schemas[0].inputSchema } }]);
    expect(turn.tools.deferredTools).toEqual([]);
  });
  it("retains the normal operator preferences, hard floors, complete persona and exact authorized tool surface", async () => {
    configure();
    const turn = await prepareRemoteReviewAttempt({ parsed, userContext: human, restricted: true }, ports);
    expect(turn.conversation).toEqual({ systemPrompt: "Complete persona\nAll review criteria", chatHistory: [{ role: "user", content: parsed.prompt }] });
    const input = await preparePresentReassessmentInput({ turn, parsed, token: { tokenId: "token", userId: "human", source: "oauth", capability: "write" },
      threadId: "thread", taskRunId: "TR-MCP-present", requestDigest: "c".repeat(64) }, sensitivityPort);
    expect(input.options).toMatchObject({ preferredProviderId: "operator-provider", preferredModelId: "operator-model", budgetClass: "quality_first",
      residencyPolicy: "approved_cloud", minimumCapabilities: { toolUse: true }, agentMinimumContextTokens: 16000, tools: turn.tools.toolsForProvider });
    expect(input.systemPrompt).toBe(turn.conversation.systemPrompt);
    expect(mocks.tools).toHaveBeenCalledWith(expect.objectContaining({ restrictedReviewBinding: binding }));
  });
  it("refuses missing current model configuration evidence rather than guessing away a floor", async () => {
    configure(); const turn = await prepareRemoteReviewAttempt({ parsed, userContext: human, restricted: true }, ports);
    mocks.model.mockRejectedValue(new Error("unavailable"));
    await expect(preparePresentReassessmentInput({ turn, parsed, token: { tokenId: "token", userId: "human", source: "oauth", capability: "write" },
      threadId: "thread", taskRunId: "TR-MCP-present", requestDigest: "c".repeat(64) }, sensitivityPort)).rejects.toThrow("unavailable");
  });
});
