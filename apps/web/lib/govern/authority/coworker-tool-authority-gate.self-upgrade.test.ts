import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import type { ToolDefinition } from "@/lib/mcp-tool-types";
import { coworkerAuthorityInputFixture } from "@/test-support/coworker-authority-input-fixture";
import { buildCoworkerApprovalBinding } from "./coworker-authority-decision";

const io = vi.hoisted(() => ({ batch: vi.fn(), latest: vi.fn(), admission: vi.fn(), target: vi.fn(), defer: vi.fn(), grants: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/coworker/authority-approval-envelope", () => ({ hasCurrentAuthorityApproval: async () => false }));
vi.mock("@/lib/self-upgrade/config", () => ({ getSelfUpgradeConfig: async () => ({ enabled: true, sourceMode: "upstream", maintenanceWindows: [], checkIntervalHours: 24 }) }));
vi.mock("@/lib/self-upgrade/release-batch-status", () => ({ resolveReleaseBatchStatus: io.batch }));
vi.mock("@/lib/self-upgrade/run-store", () => ({ getLatestRun: io.latest }));
vi.mock("@/lib/self-upgrade/support", () => ({ readSelfUpgradeSupport: async () => ({ supported: true, targetKind: "git-source" }) }));
vi.mock("@/lib/self-upgrade/admission", () => ({ admitSelfUpgrade: io.admission, resolveCurrentSelfUpgradeTarget: io.target }));
vi.mock("@/lib/install/instance-stance", () => ({ loadInstanceStance: async () => ({ environmentClass: "production", primaryPurpose: "operate-organization" }), prismaInstanceStanceStore: () => ({}) }));
vi.mock("@/lib/self-upgrade/upgrade-timing", () => ({ decideUpgradeTiming: async () => ({ kind: "run-now", windowBypassed: false }), deferUpgradeToWindow: io.defer, withWindowBypass: (s: string) => s }));
vi.mock("@/lib/tak/agent-grants", async (original) => ({ ...await original<object>(), getAgentToolGrantsAsync: io.grants }));

import { enforceCoworkerToolAuthority, setCoworkerToolAuthorityOverridesForTests } from "./coworker-tool-authority-gate";

const tool = { name: "request_self_upgrade", requiredCapability: "manage_provider_connections", sideEffect: true, executionMode: "immediate", consequence: "irreversible" } as ToolDefinition;
const execution = { toolName: tool.name, rawParams: { reason: "Validate the approved repair" }, userId: "user-1", context: { agentId: "AGT-100" }, source: "agentic-loop", userContext: { userId: "user-1", isSuperuser: true, platformRole: "HR-000" } } as GovernedExecuteArgs;
const envelope = vi.fn(async () => ({ id: "ENV-NEW", status: "proposed", expiresAt: new Date(Date.now() + 60_000) }));
const projection = vi.fn(async () => ({ outcome: "not-authorized" as const }));
function authorityInput() {
  const input = coworkerAuthorityInputFixture();
  input.authContext.grantedCapabilities = ["manage_provider_connections", "view_operations"];
  input.action = { toolName: tool.name, requiredCapability: "manage_provider_connections", agentGrantAllowed: true, sideEffect: true, executionMode: "immediate", routeContext: null, approvalPolicy: "all", consequence: "irreversible", policyProjectionAllowed: false };
  input.steering = "scheduled-mandate";
  input.rawParams = execution.rawParams;
  return input;
}
function arrange(input = authorityInput()) {
  setCoworkerToolAuthorityOverridesForTests({ resolveCoworkerAuthorityInput: async () => input, authorizationDecisionCreate: async () => ({}), authorityApprovalEnvelopeCreate: envelope, policyAuthorityProjectionAttempt: projection, authorityExecutedOutcome: async () => null });
}
beforeEach(() => {
  vi.clearAllMocks();
  io.latest.mockResolvedValue(null);
  io.grants.mockResolvedValue(["admin_write", "release_plan_read"]);
  io.batch.mockResolvedValue({ applicable: true, eligible: false, reason: "below-threshold", pendingCount: 2, minPendingPrs: 10, maxWaitHours: 168, oldestPendingAt: null, summary: "2 updates; threshold 10." });
  arrange();
});
afterEach(() => setCoworkerToolAuthorityOverridesForTests({ resolveCoworkerAuthorityInput: null, authorizationDecisionCreate: null, authorityApprovalEnvelopeCreate: null, policyAuthorityProjectionAttempt: null, authorityExecutedOutcome: null }));

describe("non-deploying update requests before new approvals", () => {
  it("returns the canonical below-threshold result without creating an approval or admitting an update", async () => {
    expect(await enforceCoworkerToolAuthority(execution, tool, true)).toMatchObject({ outcome: "not-admitted", result: { success: true, data: { status: "batch_below_threshold", pendingPrCount: 2 } } });
    expect(io.batch).toHaveBeenCalledOnce();
    expect(envelope).not.toHaveBeenCalled();
    expect(projection).not.toHaveBeenCalled();
    expect(io.target).not.toHaveBeenCalled();
    expect(io.admission).not.toHaveBeenCalled();
    expect(io.defer).not.toHaveBeenCalled();
  });
  it("preserves current action grant denial before observing the release queue", async () => {
    const input = authorityInput(); input.action.agentGrantAllowed = false; arrange(input);
    expect(await enforceCoworkerToolAuthority(execution, tool, false)).toMatchObject({ outcome: "reject", rejection: "authority_denied" });
    expect(io.batch).not.toHaveBeenCalled(); expect(envelope).not.toHaveBeenCalled();
  });
  it("retains human approval when the production batch is eligible", async () => {
    io.batch.mockResolvedValue({ applicable: true, eligible: true, reason: "threshold-met" });
    expect(await enforceCoworkerToolAuthority(execution, tool, true)).toMatchObject({ outcome: "reject", rejection: "approval_required" });
    expect(envelope).toHaveBeenCalledOnce(); expect(io.admission).not.toHaveBeenCalled();
  });
  it("retains human approval when the tally is uncomputable and fails open for ordinary admission", async () => {
    io.batch.mockResolvedValue({ applicable: true, eligible: true, reason: "uncomputable" });
    expect(await enforceCoworkerToolAuthority(execution, tool, true)).toMatchObject({ outcome: "reject", rejection: "approval_required" });
    expect(envelope).toHaveBeenCalledOnce(); expect(io.admission).not.toHaveBeenCalled();
  });
  it("does not read a release tally without current coworker queue-read grants", async () => {
    io.grants.mockResolvedValue(["backlog_read"]);
    expect(await enforceCoworkerToolAuthority(execution, tool, true)).toMatchObject({ outcome: "reject", rejection: "approval_required" });
    expect(io.batch).not.toHaveBeenCalled(); expect(envelope).toHaveBeenCalledOnce();
  });
  it("keeps a platform approval resumption on its original path", async () => {
    expect(await enforceCoworkerToolAuthority({ ...execution, context: { ...execution.context, approvalCompletion: "platform" } }, tool, true)).toMatchObject({ outcome: "reject", rejection: "approval_required" });
    expect(io.batch).not.toHaveBeenCalled();
  });
  it("preserves withheld scheduled authority before observation", async () => {
    expect(await enforceCoworkerToolAuthority({ ...execution, context: { ...execution.context, allowApprovalRequest: false } }, tool, true)).toMatchObject({ outcome: "reject", rejection: "authority_denied" });
    expect(io.batch).not.toHaveBeenCalled(); expect(envelope).not.toHaveBeenCalled();
  });
  it("keeps an existing approved envelope on its reservation path", async () => {
    const input = authorityInput();
    input.approval = { envelopeId: "ENV-OLD", status: "approved", expiresAt: new Date(Date.now() + 60_000), binding: buildCoworkerApprovalBinding(input) };
    arrange(input); setCoworkerToolAuthorityOverridesForTests({ policyAuthorityEnvelopeReserve: async () => true });
    try {
      expect(await enforceCoworkerToolAuthority(execution, tool, true)).toMatchObject({ outcome: "allow", approvedEnvelopeId: "ENV-OLD" });
      expect(io.batch).not.toHaveBeenCalled(); expect(envelope).not.toHaveBeenCalled();
    } finally { setCoworkerToolAuthorityOverridesForTests({ policyAuthorityEnvelopeReserve: null }); }
  });
});
