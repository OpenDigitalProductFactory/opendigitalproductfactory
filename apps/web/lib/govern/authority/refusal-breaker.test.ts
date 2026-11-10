import { describe, expect, it, vi } from "vitest";

import {
  createRefusalBreaker,
  isParkedRefusal,
  refusalBreakerKey,
  refusalNextAction,
  type RefusalBreakerTrip,
} from "./refusal-breaker";
import type { GovernedExecuteResult } from "@/lib/mcp-governed-execute-types";

const CALL = { toolName: "record_initiative_evidence", principal: "AGT-WS-BUILD@user-1", agentId: "AGT-WS-BUILD", sideEffect: true };

function denied(): GovernedExecuteResult {
  return {
    success: false,
    error: "authority_denied",
    message: "record_initiative_evidence rejected: grant missing",
    disposition: "refused",
    governance: { rejected: "authority_denied", authorityReason: "agent-grant-denied" },
  };
}

function pending(envelopeId = "ENV-1"): GovernedExecuteResult {
  return {
    success: false,
    error: "approval_required",
    message: "merge_backlog_items is waiting for a person to approve it.",
    disposition: "awaiting-person",
    data: { envelopeId, expiresAt: "2026-10-29T00:00:00.000Z", approvalBinding: { actingHumanUserId: "user-1" } },
    governance: { rejected: "approval_required" },
  };
}

function harness(overrides: { envelopeStatus?: string; expiresAt?: Date | null } = {}) {
  let now = Date.parse("2026-10-28T12:00:00Z");
  const trips: RefusalBreakerTrip[] = [];
  const envelopeStatus = vi.fn(async (_id: string) => ({
    status: overrides.envelopeStatus ?? "proposed",
    expiresAt: overrides.expiresAt === undefined ? new Date("2026-10-29T00:00:00Z") : overrides.expiresAt,
  }));
  const breaker = createRefusalBreaker({
    now: () => now,
    envelopeStatus,
    recordTrip: async (trip) => { trips.push(trip); },
  });
  return { breaker, trips, envelopeStatus, advance: (ms: number) => { now += ms; } };
}

describe("refusal fingerprint", () => {
  it("is identical for the same principal, tool, args and authority facts regardless of key order", () => {
    const a = refusalBreakerKey({ userId: "u", agentId: "A", toolName: "t", params: { x: 1, y: { b: 2, a: 1 } }, facts: { grants: ["g"] } });
    const b = refusalBreakerKey({ userId: "u", agentId: "A", toolName: "t", params: { y: { a: 1, b: 2 }, x: 1 }, facts: { grants: ["g"] } });
    expect(a).toBe(b);
  });

  it("changes when the args, the principal or the authority facts change", () => {
    const base = { userId: "u", agentId: "A", toolName: "t", params: { x: 1 }, facts: { grants: ["g"] } };
    expect(refusalBreakerKey(base)).not.toBe(refusalBreakerKey({ ...base, params: { x: 2 } }));
    expect(refusalBreakerKey(base)).not.toBe(refusalBreakerKey({ ...base, facts: { grants: ["g", "h"] } }));
    expect(refusalBreakerKey(base)).not.toBe(refusalBreakerKey({ ...base, agentId: "B" }));
  });
});

describe("nextAction on every refusal envelope", () => {
  it("a settled refusal says never retry and that a change of authority wakes the caller", () => {
    expect(refusalNextAction("record_initiative_evidence", denied())).toMatchObject({
      retry: "never",
      wakeBy: { kind: "authority-change" },
    });
  });

  it("an approval wait names the exact readback call, the envelope and the approver", () => {
    expect(refusalNextAction("merge_backlog_items", pending("ENV-9"))).toEqual(expect.objectContaining({
      retry: "never",
      call: { tool: "get_my_approval_status", args: { envelopeId: "ENV-9" } },
      wakeBy: { kind: "approval-decision", envelopeId: "ENV-9", principal: "user-1" },
    }));
  });

  it("an inconclusive check backs off rather than retrying at once", () => {
    const next = refusalNextAction("t", { success: false, error: "authority_evidence_unavailable", message: "", disposition: "inconclusive" });
    expect(next).toMatchObject({ retry: "after" });
    expect(next?.retryAfterMs).toBeGreaterThan(0);
  });

  it("a tool-level governed refusal is classified by its code", () => {
    expect(refusalNextAction("record_initiative_design_review", { success: false, error: "ARTIFACT_AUTHOR_REQUIRED", message: "" }))
      .toMatchObject({ retry: "after-input", wakeBy: { kind: "input-change" } });
  });

  it("an argument validation failure is never retried unchanged", () => {
    expect(refusalNextAction("release_workroom_scope", { success: false, error: "invalid_input", message: "" }))
      .toMatchObject({ retry: "never" });
  });

  it("a stale independent-review request waits on refreshed input (5,947 live repeats)", () => {
    expect(refusalNextAction("request_coworker", { success: false, error: "independent_review_request_denied", message: "" }))
      .toMatchObject({ retry: "after-input" });
  });

  it("success, an unclassified fault and a proceed outcome carry none", () => {
    expect(refusalNextAction("t", { success: true, message: "ok" })).toBeNull();
    expect(refusalNextAction("t", { success: false, error: "tool_threw", message: "boom" })).toBeNull();
    expect(refusalNextAction("t", { success: false, error: "idempotency_conflict", message: "" })).toBeNull();
  });

  it("observe attaches nextAction to data without dropping the caller's data", () => {
    const { breaker } = harness();
    const result = breaker.observe("k", CALL, pending("ENV-2"));
    expect(result.data).toMatchObject({ envelopeId: "ENV-2", retry: "never", nextAction: { retry: "never" } });
  });

  it("a handler's own nextAction is kept; retry is still added", () => {
    const { breaker } = harness();
    const result = breaker.observe("k", CALL, {
      success: false, error: "gate_evidence_blocked", message: "", data: { nextAction: "record_initiative_evidence" },
    });
    expect(result.data).toMatchObject({ nextAction: "record_initiative_evidence", retry: "after-input" });
  });
});

describe("the breaker parks an identical refusal", () => {
  it("returns the same envelope for the identical call without re-evaluating, and records one trip", async () => {
    const { breaker, trips } = harness();
    expect(await breaker.parked("k")).toBeNull();
    const first = breaker.observe("k", CALL, denied());

    const second = await breaker.parked("k");
    const third = await breaker.parked("k");
    expect(second).toMatchObject({ success: false, error: "authority_denied", governance: { rejected: "authority_denied", parked: { refusals: 1 } } });
    expect(isParkedRefusal(second)).toBe(true);
    expect(isParkedRefusal(first)).toBe(false);
    expect(third?.data).toMatchObject({ nextAction: { retry: "never" } });
    await vi.waitFor(() => expect(trips).toHaveLength(1));
    expect(trips[0]).toMatchObject({ toolName: "record_initiative_evidence", code: "authority_denied", principal: "AGT-WS-BUILD@user-1" });
  });

  it("re-evaluates once the window lapses", async () => {
    const { breaker, advance } = harness();
    breaker.observe("k", CALL, denied());
    advance(31 * 60_000);
    expect(await breaker.parked("k")).toBeNull();
  });

  it("an identical approval resubmission returns the existing envelope id while it is still pending", async () => {
    const { breaker, envelopeStatus } = harness();
    breaker.observe("k", CALL, pending("ENV-7"));
    const again = await breaker.parked("k");
    expect(again?.data).toMatchObject({ envelopeId: "ENV-7" });
    expect(envelopeStatus).toHaveBeenCalledWith("ENV-7");
  });

  it("a decided approval releases the park so the approved call can run", async () => {
    const { breaker } = harness({ envelopeStatus: "approved" });
    breaker.observe("k", CALL, pending("ENV-7"));
    expect(await breaker.parked("k")).toBeNull();
  });

  it("an expired approval releases the park", async () => {
    const { breaker } = harness({ expiresAt: new Date("2026-10-28T11:00:00Z") });
    breaker.observe("k", CALL, pending("ENV-7"));
    expect(await breaker.parked("k")).toBeNull();
  });

  it("an awaiting-input refusal is released by the same principal's next successful write", async () => {
    const { breaker } = harness();
    breaker.observe("k", CALL, { success: false, error: "ARTIFACT_AUTHOR_REQUIRED", message: "no author" });
    expect(await breaker.parked("k")).not.toBeNull();
    breaker.observe("other", { ...CALL, toolName: "record_workroom_evidence" }, { success: true, message: "ok" });
    expect(await breaker.parked("k")).toBeNull();
  });

  it("a settled refusal is not released by an unrelated write", async () => {
    const { breaker } = harness();
    breaker.observe("k", CALL, denied());
    breaker.observe("other", { ...CALL, toolName: "record_workroom_evidence" }, { success: true, message: "ok" });
    expect(await breaker.parked("k")).not.toBeNull();
  });

  it("an inconclusive result gets one free retry, then backs off, doubling per identical repeat", async () => {
    const { breaker, advance } = harness();
    const inconclusive: GovernedExecuteResult = { success: false, error: "authority_evidence_unavailable", message: "", disposition: "inconclusive" };
    breaker.observe("k", CALL, inconclusive);
    expect(await breaker.parked("k")).toBeNull();
    breaker.observe("k", CALL, inconclusive);
    expect(await breaker.parked("k")).not.toBeNull();
    advance(31_000);
    expect(await breaker.parked("k")).toBeNull();
    breaker.observe("k", CALL, inconclusive);
    advance(31_000);
    expect(await breaker.parked("k")).not.toBeNull();
    advance(30_000);
    expect(await breaker.parked("k")).toBeNull();
  });

  it("does not park faults or successes", async () => {
    const { breaker } = harness();
    breaker.observe("k", CALL, { success: false, error: "tool_threw", message: "boom" });
    expect(await breaker.parked("k")).toBeNull();
    breaker.observe("k", CALL, { success: true, message: "ok" });
    expect(await breaker.parked("k")).toBeNull();
  });

  it("a trip-recording failure never changes the parked answer", async () => {
    const breaker = createRefusalBreaker({ now: () => 0, recordTrip: async () => { throw new Error("db down"); } });
    breaker.observe("k", CALL, denied());
    await expect(breaker.parked("k")).resolves.toMatchObject({ error: "authority_denied" });
  });
});
