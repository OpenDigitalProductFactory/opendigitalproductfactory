import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONSULT_WINDOW_MS,
  createDecisionRoutingGovernanceHook,
  decidePreTool,
  resolveDecisionGateMode,
  _resetConsultationLedgerForTests,
} from "./decision-routing-governance-hook";

const BASE = {
  rawParams: {},
  userId: "coworker-1",
  userContext: { platformRole: "ceo", isSuperuser: true } as never,
  source: "agentic-loop" as const,
};

const decisionEvent = (over: Record<string, unknown> = {}) => ({
  ...BASE,
  toolName: "triage_backlog_item",
  ...over,
});

const okResult = { success: true, message: "ok" };

beforeEach(() => {
  _resetConsultationLedgerForTests();
});

// ── mode resolution ──────────────────────────────────────────────────────────

describe("resolveDecisionGateMode", () => {
  it("defaults to enforce; honors shadow/off; ignores garbage", () => {
    expect(resolveDecisionGateMode({})).toBe("enforce");
    expect(resolveDecisionGateMode({ DPF_DECISION_GATE_MODE: "shadow" })).toBe("shadow");
    expect(resolveDecisionGateMode({ DPF_DECISION_GATE_MODE: "OFF" })).toBe("off");
    expect(resolveDecisionGateMode({ DPF_DECISION_GATE_MODE: "nonsense" })).toBe("enforce");
  });
});

// ── pure decision ─────────────────────────────────────────────────────────────

describe("decidePreTool", () => {
  it("denies an unconsulted consequential decision in enforce mode", () => {
    const d = decidePreTool(decisionEvent(), { mode: "enforce", hasConsult: false });
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/principle_decide|consult-scopes/);
  });

  it("allows once consulted", () => {
    expect(decidePreTool(decisionEvent(), { mode: "enforce", hasConsult: true }).decision).toBe("allow");
  });

  it("shadow mode never denies (audit-only)", () => {
    expect(decidePreTool(decisionEvent(), { mode: "shadow", hasConsult: false }).decision).toBe("allow");
  });

  it("off mode is a no-op", () => {
    expect(decidePreTool(decisionEvent(), { mode: "off", hasConsult: false }).decision).toBe("allow");
  });

  it("ignores non-consequential tools", () => {
    expect(decidePreTool(decisionEvent({ toolName: "query_backlog" }), { mode: "enforce", hasConsult: false }).decision).toBe("allow");
  });

  it("ignores non-agentic-loop surfaces (external CLI = plane 1; REST = operator)", () => {
    for (const source of ["external-jsonrpc", "rest", "jsonrpc", "internal-mcp-session"]) {
      expect(decidePreTool(decisionEvent({ source }), { mode: "enforce", hasConsult: false }).decision).toBe("allow");
    }
  });

  it("also governs retire_backlog_item", () => {
    expect(decidePreTool(decisionEvent({ toolName: "retire_backlog_item" }), { mode: "enforce", hasConsult: false }).decision).toBe("deny");
  });
});

// ── hook lifecycle: consultation window + fail-open ───────────────────────────

describe("createDecisionRoutingGovernanceHook", () => {
  it("denies before consultation, allows after a principle_decide success, re-denies after the window", async () => {
    let t = 1_000_000;
    const hook = createDecisionRoutingGovernanceHook({ now: () => t });

    // unconsulted → deny
    expect((await hook.onPreToolUse!(decisionEvent()))?.decision).toBe("deny");

    // principle_decide succeeds → recorded
    await hook.onPostToolUse!({ ...decisionEvent({ toolName: "principle_decide" }), result: okResult, durationMs: 5 } as never);

    // within window → allow
    t += CONSULT_WINDOW_MS - 1;
    expect((await hook.onPreToolUse!(decisionEvent()))?.decision).toBe("allow");

    // past window → deny again
    t += 2;
    expect((await hook.onPreToolUse!(decisionEvent()))?.decision).toBe("deny");
  });

  it("does not record a FAILED principle_decide", async () => {
    const hook = createDecisionRoutingGovernanceHook({ now: () => 5_000 });
    await hook.onPostToolUse!({ ...decisionEvent({ toolName: "principle_decide" }), result: { success: false, message: "x" }, durationMs: 1 } as never);
    expect((await hook.onPreToolUse!(decisionEvent()))?.decision).toBe("deny");
  });

  it("consultation is scoped per user", async () => {
    const hook = createDecisionRoutingGovernanceHook({ now: () => 9_000 });
    await hook.onPostToolUse!({ ...decisionEvent({ toolName: "principle_decide", userId: "userA" }), result: okResult, durationMs: 1 } as never);
    expect((await hook.onPreToolUse!(decisionEvent({ userId: "userA" })))?.decision).toBe("allow");
    expect((await hook.onPreToolUse!(decisionEvent({ userId: "userB" })))?.decision).toBe("deny");
  });

  it("emits an audit signal on an unconsulted consequential decision (shadow included)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hook = createDecisionRoutingGovernanceHook({ now: () => 1, mode: "shadow" });
    await hook.onPreToolUse!(decisionEvent());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[decision-routing-gate]"), expect.anything(), expect.anything(), expect.anything(), expect.anything());
    warn.mockRestore();
  });

  it("fails open when the event is malformed", async () => {
    const hook = createDecisionRoutingGovernanceHook({ mode: "enforce" });
    // @ts-expect-error deliberately malformed
    expect((await hook.onPreToolUse!(null))?.decision).toBe("allow");
  });
});
