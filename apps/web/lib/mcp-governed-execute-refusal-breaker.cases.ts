// BI-E458A9CB / BI-E4FEF984 at the governed-execute seam: an identical refused
// call is answered from its park, with no new authority row, no new audit row
// and no new approval card. Registered by mcp-governed-execute.test.ts, which
// owns the harness.
import { describe, expect, it, vi } from "vitest";

import type { CoworkerAuthorityInput } from "./govern/authority/coworker-authority-decision";
import { governedExecuteTool, type _setGovernanceForTests } from "./mcp-governed-execute";

type GovernanceOverrides = Parameters<typeof _setGovernanceForTests>[0];

type RefusalBreakerHarness = {
  applyOverrides(overrides: GovernanceOverrides): void;
  authorityInput(overrides?: Partial<CoworkerAuthorityInput>): CoworkerAuthorityInput;
  normalUser: { platformRole: string; isSuperuser: boolean };
  executeMock(): ReturnType<typeof vi.fn>;
  authorityRows(): Record<string, unknown>[];
  auditRows(): Record<string, unknown>[];
  approvalEnvelopeCreate(): unknown;
};

export function registerRefusalBreakerCases(harness: RefusalBreakerHarness): void {
  describe("refusal breaker (BI-E458A9CB)", () => {
    const call = (rawParams: Record<string, unknown> = { itemId: "BI-1" }) => governedExecuteTool({
      toolName: "query_backlog",
      rawParams,
      userId: "user-1",
      userContext: harness.normalUser,
      context: { agentId: "AGT-100", routeContext: "/ops" },
      source: "external-jsonrpc",
    });

    it("parks an identical tool-level refusal: the tool runs once and one authority row is written", async () => {
      const trips: unknown[] = [];
      harness.applyOverrides({ refusalBreaker: { recordTrip: async (trip) => { trips.push(trip); } } });
      harness.executeMock().mockResolvedValue({ success: false, error: "reviewer-not-independent", message: "author cannot review" });

      const first = await call();
      const second = await call();
      const third = await call();

      expect(harness.executeMock()).toHaveBeenCalledOnce();
      expect(harness.authorityRows()).toHaveLength(1);
      expect(harness.auditRows()).toHaveLength(1);
      expect(first.data).toMatchObject({ retry: "never", nextAction: { retry: "never", wakeBy: { kind: "authority-change" } } });
      expect(first.governance?.parked).toBeUndefined();
      expect(second).toMatchObject({ success: false, error: "reviewer-not-independent", governance: { parked: { refusals: 1, parkedCalls: 1 } } });
      expect(third.governance?.parked).toMatchObject({ parkedCalls: 2 });
      await vi.waitFor(() => expect(trips).toHaveLength(1));
    });

    it("different arguments are a different call and are evaluated", async () => {
      harness.executeMock().mockResolvedValue({ success: false, error: "reviewer-not-independent", message: "no" });
      await call({ itemId: "BI-1" });
      await call({ itemId: "BI-2" });
      expect(harness.executeMock()).toHaveBeenCalledTimes(2);
    });

    it("a grant change is a different call and is evaluated", async () => {
      harness.executeMock().mockResolvedValue({ success: false, error: "reviewer-not-independent", message: "no" });
      await call();
      harness.applyOverrides({ resolveAgentGrants: async () => ["backlog_read", "backlog_write", "review_write"] });
      harness.executeMock().mockResolvedValue({ success: true, message: "ok" });
      const after = await call();
      expect(after.success).toBe(true);
    });

    it("an identical approval resubmission returns the existing envelope and mints no new card", async () => {
      const pendingInput = harness.authorityInput({
        action: {
          ...harness.authorityInput().action,
          toolName: "create_backlog_item",
          requiredCapability: "manage_backlog",
          sideEffect: true,
          approvalPolicy: "side-effects",
        },
        rawParams: { title: "merge these" },
      });
      harness.applyOverrides({
        resolveCoworkerAuthorityInput: async () => pendingInput,
        refusalBreaker: { envelopeStatus: async () => ({ status: "proposed", expiresAt: null }), recordTrip: async () => undefined },
      });
      const submit = () => governedExecuteTool({
        toolName: "create_backlog_item",
        rawParams: { title: "merge these" },
        userId: "user-1",
        userContext: harness.normalUser,
        context: { agentId: "AGT-100", routeContext: "/ops" },
        source: "external-jsonrpc",
      });

      const first = await submit();
      const again = await submit();

      expect(first).toMatchObject({ error: "approval_required", data: { envelopeId: "ENV-1", retry: "never" } });
      expect(first.data?.nextAction).toMatchObject({ call: { tool: "get_my_approval_status", args: { envelopeId: "ENV-1" } } });
      expect(again).toMatchObject({ error: "approval_required", data: { envelopeId: "ENV-1" }, governance: { parked: { parkedCalls: 1 } } });
      expect(harness.approvalEnvelopeCreate()).toHaveBeenCalledOnce();
      expect(harness.authorityRows()).toHaveLength(1);
    });

    it("a person driving the REST surface directly is answered fresh each time", async () => {
      harness.executeMock().mockResolvedValue({ success: false, error: "reviewer-not-independent", message: "no" });
      const human = () => governedExecuteTool({
        toolName: "query_backlog", rawParams: {}, userId: "user-1", userContext: harness.normalUser, source: "rest",
      });
      await human();
      await human();
      expect(harness.executeMock()).toHaveBeenCalledTimes(2);
    });
  });
}
