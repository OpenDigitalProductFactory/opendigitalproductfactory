import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePresentReassessmentSubmission } from "./mcp-task-reassessment-submission";

const mocks = vi.hoisted(() => ({ policy: vi.fn(), originals: vi.fn(), turn: vi.fn(), input: vi.fn(), route: vi.fn(), precheck: vi.fn(),
  compatibility: vi.fn(), authority: vi.fn(), admission: vi.fn() }));
vi.mock("./mcp-task-review-reassessment", () => ({ readApprovedReassessmentPolicy: mocks.policy, readAuthorizedReassessmentOriginals: mocks.originals }));
vi.mock("./mcp-task-reassessment-preparation", () => ({ prepareRemoteReviewAttempt: mocks.turn, preparePresentReassessmentInput: mocks.input }));
vi.mock("./inference/reassessment-execution-qualification", () => ({ prepareReassessmentNativeCandidateRoute: mocks.route, precheckReassessmentNativeCandidate: mocks.precheck }));
vi.mock("./mcp-task-reassessment-contract", () => ({ readCurrentReassessmentContract: mocks.compatibility }));
vi.mock("./mcp-task-reassessment-authority", () => ({ createPresentReassessmentAuthority: mocks.authority }));
vi.mock("./mcp-task-reassessment-admission", () => ({ createPresentReassessmentAdmission: mocks.admission }));
const authority = { authorityDecisionId: "allow-current", actingAgentId: "AGT-AUTHOR", tokenGrantScopes: ["backlog_read"] };
const args = () => ({ parsed: { agentId: "AGT-WS-REVIEW", riskClass: "bounded-write", initiativeReviewBinding: {
  itemId: "BI-285EF102", gate: "design-spec", presentReassessment: { authorizationItemId: "BI-7906C73E" } } },
  taskRunId: "TR-CURRENT", requestDigest: "d".repeat(64), threadId: "thread", token: { source: "oauth", capability: "write", tokenId: "token", userId: "human" },
  userContext: { userId: "human" }, requestAuthority: { ...authority, tokenGrantScopes: [...authority.tokenGrantScopes] } });
const ports = { resolveAgent: vi.fn(), resolveTools: vi.fn(), resolveSensitivity: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.policy.mockResolvedValue({ baselineId: "approved" }); mocks.originals.mockResolvedValue(["D2", "4E"]);
  mocks.turn.mockResolvedValue({ resolvedAgentId: "AGT-WS-REVIEW" }); mocks.input.mockResolvedValue({ exact: "current-prepared-input" });
  mocks.route.mockResolvedValue({ status: "runtime-facts-required", candidatePlan: { providerId: "local" } });
  mocks.precheck.mockResolvedValue({ budgetConfiguration: { configurationDigest: "budget" }, bounds: { maxProviderStarts: 2 }, nativeObservationUrls: ["http://runtime/version"] });
  mocks.compatibility.mockResolvedValue({ configDigest: "actual-current-container" });
  mocks.authority.mockReturnValue(vi.fn()); mocks.admission.mockReturnValue({ admissionGuard: vi.fn(), afterTaskCreated: vi.fn() });
});

describe("present review preallocation submission", () => {
  it("returns no special admission for ordinary reviews", async () => {
    const input = args(); delete (input.parsed.initiativeReviewBinding as Partial<typeof input.parsed.initiativeReviewBinding>).presentReassessment;
    expect(await preparePresentReassessmentSubmission(input as never, ports as never)).toBeNull();
    expect(mocks.policy).not.toHaveBeenCalled(); expect(mocks.route).not.toHaveBeenCalled();
  });
  it.each(["missing-server-authority", "recipe", "recovery", "high-risk"])("refuses %s before allocation preparation", async problem => {
    const input = args() as Record<string, any>;
    if (problem === "missing-server-authority") delete input.requestAuthority;
    if (problem === "recipe") input.parsed.recipeId = "recipe";
    if (problem === "recovery") input.parsed.reviewRecovery = {};
    if (problem === "high-risk") input.parsed.riskClass = "high-risk";
    await expect(preparePresentReassessmentSubmission(input as never, ports as never)).rejects.toThrow("reassessment-authority-unproven");
    expect(mocks.policy).not.toHaveBeenCalled(); expect(mocks.turn).not.toHaveBeenCalled();
  });
  it("refuses a concrete unsupported normal winner before compatibility probing or admission", async () => {
    mocks.route.mockResolvedValue({ status: "unsupported-normal-winner", candidatePlan: null });
    await expect(preparePresentReassessmentSubmission(args() as never, ports as never)).rejects.toThrow("reassessment-native-normal-selection-unsupported");
    expect(mocks.precheck).not.toHaveBeenCalled(); expect(mocks.compatibility).not.toHaveBeenCalled(); expect(mocks.admission).not.toHaveBeenCalled();
  });
  it("uses exact prepared normal input and immutable actual server authority for one atomic admission", async () => {
    const input = args();
    const prepared = await preparePresentReassessmentSubmission(input as never, ports as never);
    expect(mocks.route).toHaveBeenCalledWith({ exact: "current-prepared-input" });
    expect(mocks.precheck).toHaveBeenCalledWith({ exact: "current-prepared-input" }, { providerId: "local" });
    expect(mocks.admission).toHaveBeenCalledWith(expect.objectContaining({ taskRunId: "TR-CURRENT", originals: ["D2", "4E"],
      authorityDecisionId: "allow-current", candidate: expect.objectContaining({ nativeObservationUrls: ["http://runtime/version"] }) }), { validateAuthority: expect.any(Function) });
    input.requestAuthority.tokenGrantScopes.push("later-change");
    expect(prepared?.requestAuthority.tokenGrantScopes).toEqual(["backlog_read"]);
    expect(Object.isFrozen(prepared?.requestAuthority)).toBe(true);
    expect(Object.isFrozen(prepared?.requestAuthority.tokenGrantScopes)).toBe(true);
  });
});
