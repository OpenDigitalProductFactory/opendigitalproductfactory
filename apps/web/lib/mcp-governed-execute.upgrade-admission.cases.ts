import { beforeEach, describe, expect, it, vi } from "vitest";
import { governedExecuteTool, type _setGovernanceForTests } from "./mcp-governed-execute";
import { coworkerAuthorityInputFixture } from "../test-support/coworker-authority-input-fixture";

const observation = vi.hoisted(() => vi.fn());
vi.mock("./self-upgrade/request-approval-preflight", () => ({ preflightUnadmittedUpgrade: observation }));
vi.mock("@/lib/install/instance-stance", () => ({ loadInstanceStance: async () => ({ environmentClass: "production", primaryPurpose: "operate-organization" }), prismaInstanceStanceStore: () => ({}) }));

export function registerUpgradeAdmissionCases(evidence: {
  auditRows(): Record<string, unknown>[];
  receiptRows(): Record<string, unknown>[];
  executionCalls(): unknown[][];
  applyOverrides(overrides: Parameters<typeof _setGovernanceForTests>[0]): void;
}): void {
  describe("terminal update observation through the assembled executor", () => {
    beforeEach(() => { observation.mockReset(); observation.mockResolvedValue(null); });
    const run = () => governedExecuteTool({ toolName: "request_self_upgrade", rawParams: { reason: "Check approved repair" }, userId: "user-1", userContext: { platformRole: "HR-000", isSuperuser: true }, context: { agentId: "AGT-100" }, source: "external-jsonrpc" });
    function arrange(allowed = true) {
      const input = coworkerAuthorityInputFixture();
      input.authContext.grantedCapabilities = ["manage_provider_connections", "view_operations"];
      input.action = { toolName: "request_self_upgrade", requiredCapability: "manage_provider_connections", agentGrantAllowed: allowed, sideEffect: true, executionMode: "immediate", approvalPolicy: "all", consequence: "irreversible", policyProjectionAllowed: false, routeContext: null };
      input.steering = "scheduled-mandate";
      evidence.applyOverrides({ resolveAgentGrants: async () => allowed ? ["admin_write", "release_plan_read"] : [], isAllowedByGrants: () => allowed, resolveCoworkerAuthorityInput: async () => input });
    }
    it("returns and audits non-admission without executing or manufacturing a receipt", async () => {
      arrange(); observation.mockResolvedValue({ success: true, message: "2 updates; threshold 10.", data: { status: "batch_below_threshold", pendingPrCount: 2 } });
      expect(await run()).toMatchObject({ success: true, data: { status: "batch_below_threshold", pendingPrCount: 2 } });
      expect(evidence.executionCalls()).toHaveLength(0); expect(evidence.receiptRows()).toHaveLength(0);
      expect(evidence.auditRows()).toHaveLength(1);
      expect(evidence.auditRows()[0]).toMatchObject({ success: true, durationMs: null, result: { data: { status: "batch_below_threshold" } } });
    });
    it("cannot execute if eligibility changes after the terminal observation; the next call needs approval", async () => {
      arrange(); observation.mockResolvedValueOnce({ success: true, data: { status: "batch_below_threshold" } }).mockResolvedValueOnce(null);
      expect(await run()).toMatchObject({ success: true, data: { status: "batch_below_threshold" } });
      expect(await run()).toMatchObject({ success: false, error: "approval_required" });
      expect(evidence.executionCalls()).toHaveLength(0);
    });
    it("preserves current action denial before the observation", async () => {
      arrange(false);
      expect(await run()).toMatchObject({ success: false, error: "authority_denied" });
      expect(observation).not.toHaveBeenCalled(); expect(evidence.executionCalls()).toHaveLength(0);
    });
  });
}
