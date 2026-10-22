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
describe("one shared remote review preparation", () => {
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
