import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/attention/notify-live", () => ({ notifyAttentionLive: vi.fn() }));

import {
  createCompletionEvidenceGovernanceHook,
  isAgentCompletionRequest,
  resolveCompletionEvidenceGateMode,
} from "./completion-evidence-governance-hook";
import type { ToolLifecycleEvent } from "@/lib/mcp-governed-execute";

function event(
  source: ToolLifecycleEvent["source"] = "external-jsonrpc",
  rawParams: Record<string, unknown> = { itemId: "BI-1", status: "done" },
): ToolLifecycleEvent {
  return {
    toolName: "update_backlog_item_status",
    rawParams,
    userId: "user-1",
    userContext: { userId: "user-1", isSuperuser: true, platformRole: null },
    context: {
      agentId: "agent-1",
      apiTokenId: "token-1",
      callerClient: "antigravity/2.3.1",
    },
    source,
  };
}

function deniedVerdict() {
  return {
    kind: "evaluated" as const,
    item: { id: "row-1", itemId: "BI-1", status: "in-progress", workType: "feature" },
    verdict: {
      allowed: false,
      noOp: false,
      normalizedManifest: null,
      blockers: [
        {
          code: "missing-manifest" as const,
          message: "completion manifest missing",
          dimension: "manifest" as const,
        },
      ],
      nextAction: "record evidence",
    },
  };
}

function allowedVerdict() {
  return {
    kind: "evaluated" as const,
    item: { id: "row-1", itemId: "BI-1", status: "in-progress", workType: "feature" },
    verdict: {
      allowed: true,
      noOp: false,
      normalizedManifest: {
        workClass: "implementation" as const,
        evidenceActivityIds: ["e1"],
        useActiveBuildEvidence: false,
        ux: { disposition: "not-applicable" as const, reason: "No user interface files changed." },
        migration: { disposition: "not-applicable" as const, reason: "No database schema changed." },
      },
      blockers: [],
      nextAction: null,
    },
  };
}

describe("completion evidence governance hook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("governs every agent execution surface but not direct operator REST", () => {
    for (const source of ["external-jsonrpc", "internal-mcp-session", "agentic-loop", "jsonrpc"] as const) {
      expect(isAgentCompletionRequest(event(source))).toBe(true);
    }
    expect(isAgentCompletionRequest(event("rest"))).toBe(true);
    const operatorRest = event("rest");
    operatorRest.context = {};
    expect(isAgentCompletionRequest(operatorRest)).toBe(false);
    expect(isAgentCompletionRequest(event("external-jsonrpc", { itemId: "BI-1", status: "open" }))).toBe(false);
  });

  it("defaults to enforce and supports shadow/off kill switches", () => {
    expect(resolveCompletionEvidenceGateMode({})).toBe("enforce");
    expect(resolveCompletionEvidenceGateMode({ DPF_COMPLETION_EVIDENCE_GATE_MODE: "shadow" })).toBe("shadow");
    expect(resolveCompletionEvidenceGateMode({ DPF_COMPLETION_EVIDENCE_GATE_MODE: "off" })).toBe("off");
    expect(resolveCompletionEvidenceGateMode({ DPF_COMPLETION_EVIDENCE_GATE_MODE: "unexpected" })).toBe("enforce");
  });

  it("denies incomplete agent completion with an actionable reason", async () => {
    const resolve = vi.fn().mockResolvedValue(deniedVerdict());
    const hook = createCompletionEvidenceGovernanceHook({
      resolve,
      countRecentInvalidAttempts: vi.fn().mockResolvedValue(0),
      recordShadow: vi.fn(),
      notifyCircuit: vi.fn(),
      mode: "enforce",
    });
    const decision = await hook.onPreToolUse?.(event());
    expect(decision).toMatchObject({ decision: "deny" });
    expect(decision?.reason).toContain("completion manifest missing");
    expect(decision?.reason).toContain("record evidence");
  });

  it("allows complete evidence even after prior invalid attempts", async () => {
    const count = vi.fn().mockResolvedValue(99);
    const hook = createCompletionEvidenceGovernanceHook({
      resolve: vi.fn().mockResolvedValue(allowedVerdict()),
      countRecentInvalidAttempts: count,
      recordShadow: vi.fn(),
      notifyCircuit: vi.fn(),
      mode: "enforce",
    });
    expect(await hook.onPreToolUse?.(event())).toEqual({ decision: "allow" });
    expect(count).not.toHaveBeenCalled();
  });

  it("records but allows an incomplete request in shadow mode", async () => {
    const recordShadow = vi.fn();
    const hook = createCompletionEvidenceGovernanceHook({
      resolve: vi.fn().mockResolvedValue(deniedVerdict()),
      countRecentInvalidAttempts: vi.fn().mockResolvedValue(0),
      recordShadow,
      notifyCircuit: vi.fn(),
      mode: "shadow",
    });
    expect(await hook.onPreToolUse?.(event())).toMatchObject({
      decision: "allow",
      reason: expect.stringContaining("shadow"),
    });
    expect(recordShadow).toHaveBeenCalledWith(
      expect.objectContaining({ itemRowId: "row-1", callerClient: "antigravity/2.3.1" }),
    );
  });

  it("never turns a shadow audit-write failure into a denial", async () => {
    const hook = createCompletionEvidenceGovernanceHook({
      resolve: vi.fn().mockResolvedValue(deniedVerdict()),
      countRecentInvalidAttempts: vi.fn(),
      recordShadow: vi.fn().mockRejectedValue(new Error("audit unavailable")),
      notifyCircuit: vi.fn(),
      mode: "shadow",
    });
    expect(await hook.onPreToolUse?.(event())).toMatchObject({ decision: "allow" });
  });

  it("does not resolve evidence when the gate is off or the request is outside scope", async () => {
    const resolve = vi.fn();
    const off = createCompletionEvidenceGovernanceHook({
      resolve,
      countRecentInvalidAttempts: vi.fn(),
      recordShadow: vi.fn(),
      notifyCircuit: vi.fn(),
      mode: "off",
    });
    expect(await off.onPreToolUse?.(event())).toEqual({ decision: "allow" });
    expect(resolve).not.toHaveBeenCalled();

    const enforce = createCompletionEvidenceGovernanceHook({
      resolve,
      countRecentInvalidAttempts: vi.fn(),
      recordShadow: vi.fn(),
      notifyCircuit: vi.fn(),
      mode: "enforce",
    });
    const operatorRest = event("rest");
    operatorRest.context = {};
    expect(await enforce.onPreToolUse?.(operatorRest)).toEqual({ decision: "allow" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("emits one circuit notification at the repeated-invalid threshold", async () => {
    const notifyCircuit = vi.fn();
    const hook = createCompletionEvidenceGovernanceHook({
      resolve: vi.fn().mockResolvedValue(deniedVerdict()),
      countRecentInvalidAttempts: vi.fn().mockResolvedValue(4),
      recordShadow: vi.fn(),
      notifyCircuit,
      mode: "enforce",
    });
    const decision = await hook.onPreToolUse?.(event());
    expect(decision?.reason).toContain("Repeated unsupported completion attempts");
    expect(notifyCircuit).toHaveBeenCalledTimes(1);
    expect(notifyCircuit).toHaveBeenCalledWith(expect.objectContaining({
      principalKey: "token:token-1",
      callerClient: "antigravity/2.3.1",
    }));
  });

  it("keeps the evidence denial when attention delivery fails", async () => {
    const hook = createCompletionEvidenceGovernanceHook({
      resolve: vi.fn().mockResolvedValue(deniedVerdict()),
      countRecentInvalidAttempts: vi.fn().mockResolvedValue(4),
      recordShadow: vi.fn(),
      notifyCircuit: vi.fn().mockRejectedValue(new Error("notification unavailable")),
      mode: "enforce",
    });
    expect(await hook.onPreToolUse?.(event())).toMatchObject({
      decision: "deny",
      reason: expect.stringContaining("Repeated unsupported completion attempts"),
    });
  });

  it("uses token, then agent, then user as the circuit identity", async () => {
    const observed: string[] = [];
    const hook = createCompletionEvidenceGovernanceHook({
      resolve: vi.fn().mockResolvedValue(deniedVerdict()),
      countRecentInvalidAttempts: vi.fn(async ({ principalKey }) => {
        observed.push(principalKey);
        return 0;
      }),
      recordShadow: vi.fn(),
      notifyCircuit: vi.fn(),
      mode: "enforce",
    });
    await hook.onPreToolUse?.(event());
    const agentEvent = event();
    agentEvent.context = { agentId: "agent-1" };
    await hook.onPreToolUse?.(agentEvent);
    const userEvent = event();
    userEvent.context = {};
    await hook.onPreToolUse?.(userEvent);
    expect(observed).toEqual(["token:token-1", "agent:agent-1", "user:user-1"]);
  });

  it("fails closed when evidence resolution fails on a consequential request", async () => {
    const hook = createCompletionEvidenceGovernanceHook({
      resolve: vi.fn().mockRejectedValue(new Error("database unavailable")),
      countRecentInvalidAttempts: vi.fn(),
      recordShadow: vi.fn(),
      notifyCircuit: vi.fn(),
      mode: "enforce",
    });
    const decision = await hook.onPreToolUse?.(event());
    expect(decision).toMatchObject({ decision: "deny" });
    expect(decision?.reason).toContain("could not be verified");
  });
});
