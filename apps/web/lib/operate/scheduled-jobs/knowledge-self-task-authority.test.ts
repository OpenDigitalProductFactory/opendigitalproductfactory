// BI-0073DE6A — the two posture self-tasks exist to write a knowledge article,
// and from 2026-07-31 to 2026-09-29 every one of their 39 attempts parked on a
// fifteen-minute approval envelope nobody saw. This runs the tool's REAL
// declaration and the REAL self-task registry through the steering resolver and
// the escalation gate, so a regression in either reopens the failure here.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/semantic-memory", () => ({}));

import { resolveEscalation } from "@/lib/govern/authority/escalation-gate";
import { resolveSteering } from "@/lib/govern/authority/resolve-coworker-tool-authority";
import { knowledgePack } from "@/lib/mcp/packs/knowledge-pack";

const TOOL = "create_knowledge_article";
const declared = knowledgePack.definitions.find((d) => d.name === TOOL)!;

function decide(agentId: string, taskRunId: string | null) {
  const steering = resolveSteering({
    initiativeReviewBinding: null,
    roomAuthority: null,
    agentId,
    toolName: TOOL,
    taskRunId,
  });
  return resolveEscalation({
    operatorRequiresApproval: true,
    action: {
      sideEffect: declared.sideEffect ?? false,
      executionMode: declared.executionMode ?? "immediate",
      consequence: declared.consequence ?? null,
    },
    dataPolicy: { sensitivity: "internal" },
    steering,
  });
}

describe("create_knowledge_article on a posture self-task (BI-0073DE6A)", () => {
  it("is an ordinary write: it only ever creates a draft, and publishing is a separate act", () => {
    expect(declared.sideEffect).toBe(true);
    expect(declared.executionMode).toBe("immediate");
    expect(declared.consequence ?? null).toBeNull();
  });

  // Live agent ids: the estate run logged "inventory-specialist", the AI Ops
  // run logged the canonical "AGT-WS-PLATFORM"; the registry resolves both.
  it.each(["inventory-specialist", "AGT-WS-INVENTORY", "platform-engineer", "AGT-WS-PLATFORM"])(
    "a scheduled run by %s is decided automatically, minting no envelope",
    (agentId) => {
      const decision = decide(agentId, "TR-SCHED-6439644E");
      expect(decision.verdict).toBe("automated");
      expect(decision.reasonCode).toBe("steered-by-scheduled-mandate");
    },
  );

  it("an interactive call with nothing recorded to steer it still goes to a person", () => {
    const decision = decide("inventory-specialist", null);
    expect(decision.verdict).toBe("human");
    expect(decision.reasonCode).toBe("unsteered-side-effect");
  });

  it("a cadence that did not declare the tool gets no licence for it", () => {
    const decision = decide("AGT-WS-MARKETING", "TR-SCHED-6439644E");
    expect(decision.verdict).toBe("human");
    expect(decision.reasonCode).toBe("unsteered-side-effect");
  });
});
