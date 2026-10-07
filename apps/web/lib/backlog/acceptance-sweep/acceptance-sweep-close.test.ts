import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

import { closeAllowedAcceptanceItem, type AcceptanceSweepCloseDb } from "./acceptance-sweep-close";
import type { CloseAuthorisation } from "./close-authorisation";

// BI-45D3BBF4 AC-2: every closure goes through completeBacklogItemTransition
// with the steward actor, the authority citing the pre-authorisation, and
// completionEvidence citing the gate's evidence. No status is written here.

const NOW = new Date("2026-10-06T05:00:00.000Z");
const AUTH: Extract<CloseAuthorisation, { state: "enabled" }> = {
  state: "enabled",
  setByUserId: "user-operator",
  setAt: "2026-10-01T09:00:00.000Z",
  reason: "Operator pre-authorised (BI-8A32EBFF).",
  limit: 25,
  agentGrant: "backlog_write",
};
const ITEM = { id: "row-1", itemId: "BI-1", claimedByAgentId: null, agentId: null };

function decision(verdict: InitiativeReadinessDecision["verdict"]): InitiativeReadinessDecision {
  return {
    decisionId: "IRD-1",
    policyVersion: "initiative-readiness.v3",
    subject: { kind: "backlog-item", id: "BI-1" },
    transitionObject: { kind: "backlog-item", id: "BI-1", expectedVersion: "read-projection", targetState: "completion" },
    profile: "feature",
    target: "completion",
    verdict,
    satisfied: [{ code: "DELIVERY_EVIDENCE_REQUIRED", state: "pass", accountableRole: "delivery-coordinator", evidenceRefs: ["act-9"], evidenceLane: "gate-receipt", unreadEvidenceRefs: [], nextAction: null }],
    unmet: [],
    blockers: [],
    evaluatedAt: NOW.toISOString(),
  } as InitiativeReadinessDecision;
}

function db(row: { status: string; organizationId: string | null } | null): AcceptanceSweepCloseDb {
  return { backlogItem: { findUnique: vi.fn(async () => row) } };
}

describe("closeAllowedAcceptanceItem", () => {
  it("calls the terminal transition as the steward, in the authorising operator's context, citing the pre-authorisation", async () => {
    const complete = vi.fn(async () => ({ ok: true as const, decision: decision("allowed"), authorityDecisionId: "DI-AB" }));
    const outcome = await closeAllowedAcceptanceItem({
      item: ITEM, decision: decision("allowed"), authorisation: AUTH, agentId: "AGT-WS-PORTFOLIO", now: NOW,
      db: db({ status: "awaiting-acceptance", organizationId: null }), complete: complete as never,
    });

    expect(outcome).toEqual({ outcome: "closed", authorityDecisionId: "DI-AB" });
    expect(complete).toHaveBeenCalledTimes(1);
    const args = (complete.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(args.itemId).toBe("BI-1");
    expect(args.expectedStatus).toBe("awaiting-acceptance");
    expect(args.actor).toEqual({ actorType: "agent", actorRef: "AGT-WS-PORTFOLIO", humanContextRef: "user-operator", agentContextRef: "AGT-WS-PORTFOLIO" });
    expect(args.authority.actionKey).toBe("update_backlog_item_status");
    expect(args.authority.rationale).toMatchObject({
      capability: "manage_backlog",
      grant: "backlog_write",
      source: "acceptance-sweep",
      preAuthorisation: { scope: "close-when-gate-allows", setByUserId: "user-operator", setAt: AUTH.setAt },
    });
    expect(args.authority.authoritySnapshot).toMatchObject({
      decision: "allow", effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "backlog_write", organizationId: "platform",
    });
    expect(args.completionEvidence).toMatchObject({
      source: "acceptance-sweep",
      readinessDecisionId: "IRD-1",
      verdict: "allowed",
      satisfied: [{ code: "DELIVERY_EVIDENCE_REQUIRED", state: "pass", evidenceRefs: ["act-9"] }],
    });
    expect(args.resolution).toContain("close-when-gate-allows");
    expect(args.resolution).toContain("user-operator");
  });

  it("reports the transition's own refusal", async () => {
    const complete = vi.fn(async () => ({ ok: false as const, code: "STALE_EVIDENCE", decision: decision("denied"), authorityDecisionId: "DI-X" }));
    const outcome = await closeAllowedAcceptanceItem({
      item: ITEM, decision: decision("allowed"), authorisation: AUTH, agentId: "A", now: NOW,
      db: db({ status: "awaiting-acceptance", organizationId: "org-1" }), complete: complete as never,
    });
    expect(outcome).toEqual({ outcome: "refused", code: "STALE_EVIDENCE", authorityDecisionId: "DI-X" });
  });

  it("skips an item that left awaiting-acceptance since the page was read", async () => {
    const complete = vi.fn();
    const outcome = await closeAllowedAcceptanceItem({
      item: ITEM, decision: decision("allowed"), authorisation: AUTH, agentId: "A", now: NOW,
      db: db({ status: "done", organizationId: null }), complete: complete as never,
    });
    expect(outcome).toEqual({ outcome: "skipped", reason: "status-changed" });
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(["input-required", "denied"] as const)("refuses outright for a %s decision and never calls the transition", async (verdict) => {
    const complete = vi.fn();
    await expect(closeAllowedAcceptanceItem({
      item: ITEM, decision: decision(verdict), authorisation: AUTH, agentId: "A", now: NOW,
      db: db({ status: "awaiting-acceptance", organizationId: null }), complete: complete as never,
    })).rejects.toThrow(/Refusing to close/);
    expect(complete).not.toHaveBeenCalled();
  });
});
