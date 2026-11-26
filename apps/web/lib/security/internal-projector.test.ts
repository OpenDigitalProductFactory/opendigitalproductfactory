import { describe, expect, it, vi } from "vitest";

import { projectInternalSecurityEvents, securityCoreFromAuthorizationDecision } from "./internal-projector";

// BI-9F7192F9 phase 3 (AC-E8): S5 rehearsal requester audit rows reach the
// internal security projection like any other allow decision, as references only.
describe("internal security projection of S5 rehearsal requester audit rows", () => {
  const row = {
    decisionId: `s5rr:enroll:${"b".repeat(64)}`,
    actorType: "human",
    actorRef: "owner-user",
    actionKey: "s5.rehearsal-requester.enroll",
    objectRef: "requester-user",
    decision: "allow",
    createdAt: new Date("2026-11-26T12:00:00Z"),
    routeContext: null,
    sensitivityLevel: null,
  };

  it("projects an informational API-activity event keyed by the decision id, without the rationale", () => {
    const core = securityCoreFromAuthorizationDecision(row);
    expect(core.eventKey).toBe(`dpf.internal:authz:${row.decisionId}`);
    expect(core.normalized).toMatchObject({ api: { operation: "s5.rehearsal-requester.enroll" }, object: "requester-user", decision: "allow" });
    expect(core.actorPrincipalId).toBe("owner-user");
    expect(JSON.stringify(core)).not.toContain("rationale");
  });

  it("upserts each audit row exactly once", async () => {
    const upsert = vi.fn(async () => {});
    const retire = { ...row, decisionId: `s5rr:retire:${"b".repeat(64)}`, actionKey: "s5.rehearsal-requester.retire" };
    await expect(projectInternalSecurityEvents({ authorizationDecisions: [row, retire], toolExecutions: [], upsert })).resolves.toEqual({ projected: 2 });
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
