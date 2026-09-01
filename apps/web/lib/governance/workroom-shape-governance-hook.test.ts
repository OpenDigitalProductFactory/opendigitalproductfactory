// Workroom shape governance hook — DI-mocked unit tests (W14, BI-E0BFFF77).

import { describe, expect, it, vi } from "vitest";

import type { ToolLifecycleEvent } from "@/lib/mcp-governed-execute";
import { buildWorkroomShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import {
  createWorkroomShapeGovernanceHook,
  resolveWorkroomGateMode,
  type WorkroomShapeGateRoom,
  type WorkroomShapeGovernanceHookDeps,
} from "./workroom-shape-governance-hook";

const OUTWARD_TOOL = { sideEffect: true, consequence: "outward" as const };
const READ_TOOL = { sideEffect: false, consequence: undefined };

function event(overrides: {
  workroomId?: string;
  agentId?: string | null;
  toolName?: string;
} = {}): ToolLifecycleEvent {
  return {
    toolName: overrides.toolName ?? "create_marketing_campaign",
    rawParams: {},
    userId: "user-1",
    userContext: { userId: "user-1", isSuperuser: false, platformRole: null },
    context: {
      agentId: overrides.agentId === null ? undefined : (overrides.agentId ?? "agent-1"),
      callerClient: "portal/coworker",
      authorizedSurfaceContext: overrides.workroomId
        ? { mode: "workroom", workroomId: overrides.workroomId }
        : { mode: "browser" },
    },
    source: "agentic-loop",
  };
}

function fullyStaffedRoom(scopeClaims: unknown = []): WorkroomShapeGateRoom {
  return {
    id: "room-row-1",
    capsuleId: "WC-TEST0001",
    scopeClaims,
    verificationEvidence: [
      { status: "passed", completedAt: "2026-08-30T12:00:00.000Z" },
    ],
    participants: [
      { principalRef: "PRN-OWNER", roles: ["accountable"] },
      { principalRef: "PRN-SPEC", roles: ["specialist"] },
      { principalRef: "PRN-APPROVER", roles: ["approver"] },
      { principalRef: "PRN-REVIEWER", roles: ["reviewer"] },
    ],
  };
}

function gappyRoom(scopeClaims: unknown = []): WorkroomShapeGateRoom {
  return {
    id: "room-row-2",
    capsuleId: "WC-TEST0002",
    scopeClaims,
    participants: [{ principalRef: "PRN-OWNER", roles: ["accountable"] }],
  };
}

function makeHook(overrides: Partial<WorkroomShapeGovernanceHookDeps> = {}) {
  const deps: WorkroomShapeGovernanceHookDeps = {
    findTool: vi.fn().mockReturnValue(OUTWARD_TOOL),
    loadRoom: vi.fn().mockResolvedValue(fullyStaffedRoom()),
    recordShadow: vi.fn().mockResolvedValue(undefined),
    mode: "shadow",
    ...overrides,
  };
  return { hook: createWorkroomShapeGovernanceHook(deps), deps };
}

describe("resolveWorkroomGateMode", () => {
  it("defaults to shadow — the deliberate inversion of the completion-evidence default", () => {
    expect(resolveWorkroomGateMode({})).toBe("shadow");
    expect(resolveWorkroomGateMode({ DPF_WORKROOM_GATE_MODE: "enforce" })).toBe("enforce");
    expect(resolveWorkroomGateMode({ DPF_WORKROOM_GATE_MODE: "off" })).toBe("off");
    expect(resolveWorkroomGateMode({ DPF_WORKROOM_GATE_MODE: "garbage" })).toBe("shadow");
  });
});

describe("workroom shape governance hook", () => {
  it("does nothing when off", async () => {
    const { hook, deps } = makeHook({ mode: "off" });
    expect(await hook.onPreToolUse?.(event({ workroomId: "WC-TEST0001" }))).toEqual({
      decision: "allow",
    });
    expect(deps.loadRoom).not.toHaveBeenCalled();
    expect(deps.recordShadow).not.toHaveBeenCalled();
  });

  it("ignores non-consequential calls entirely", async () => {
    const { hook, deps } = makeHook({
      findTool: vi.fn().mockReturnValue(READ_TOOL),
      mode: "enforce",
    });
    expect(await hook.onPreToolUse?.(event({ workroomId: "WC-TEST0001" }))).toEqual({
      decision: "allow",
    });
    expect(deps.loadRoom).not.toHaveBeenCalled();
  });

  it("passes room-less consequential calls through in enforce mode, recording the no-room verdict", async () => {
    const { hook, deps } = makeHook({ mode: "enforce" });
    expect(await hook.onPreToolUse?.(event())).toEqual({ decision: "allow" });
    expect(deps.loadRoom).not.toHaveBeenCalled();
    expect(deps.recordShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        roomRowId: null,
        verdict: expect.objectContaining({
          roomResolution: "no-room",
          withinEnvelope: null,
          decisionMode: "propose-for-approval",
        }),
      }),
    );
  });

  it("treats a dangling room id (pre-W2) as unresolved and allows", async () => {
    const { hook, deps } = makeHook({
      mode: "enforce",
      loadRoom: vi.fn().mockResolvedValue(null),
    });
    expect(await hook.onPreToolUse?.(event({ workroomId: "WC-GONE" }))).toEqual({
      decision: "allow",
    });
    expect(deps.recordShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: expect.objectContaining({ roomResolution: "room-not-found" }),
      }),
    );
  });

  it("shadow: records an envelope gap but always allows", async () => {
    const { hook, deps } = makeHook({ loadRoom: vi.fn().mockResolvedValue(gappyRoom()) });
    // A declared-outward tool with no explicit name mapping derives outward-review.
    const decision = await hook.onPreToolUse?.(
      event({ workroomId: "WC-TEST0002", toolName: "send_status_update" }),
    );
    expect(decision).toMatchObject({
      decision: "allow",
      reason: expect.stringContaining("shadow"),
    });
    expect(deps.recordShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        roomRowId: "room-row-2",
        verdict: expect.objectContaining({
          withinEnvelope: false,
          shapeSource: "tool-derived",
          declaredShape: "outward-review",
          gaps: ["specialist", "approver"],
        }),
      }),
    );
  });

  it("enforce: denies when the room is bound and the envelope has gaps, naming them", async () => {
    const { hook } = makeHook({
      mode: "enforce",
      loadRoom: vi.fn().mockResolvedValue(gappyRoom()),
    });
    const decision = await hook.onPreToolUse?.(event({ workroomId: "WC-TEST0002" }));
    expect(decision).toMatchObject({ decision: "deny" });
    expect(decision?.reason).toContain("WC-TEST0002");
    expect(decision?.reason).toContain("specialist, approver");
  });

  it("enforce: allows when the room satisfies the shape envelope", async () => {
    const { hook } = makeHook({ mode: "enforce" });
    expect(await hook.onPreToolUse?.(event({ workroomId: "WC-TEST0001" }))).toEqual({
      decision: "allow",
    });
  });

  it("prefers the room's declared shape claim over the tool-derived shape", async () => {
    const claim = buildWorkroomShapeClaim("craft-stewardship");
    const { hook, deps } = makeHook({
      loadRoom: vi.fn().mockResolvedValue(fullyStaffedRoom([claim])),
    });
    await hook.onPreToolUse?.(event({ workroomId: "WC-TEST0001" }));
    expect(deps.recordShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: expect.objectContaining({
          declaredShape: "craft-stewardship",
          shapeSource: "room-claim",
          authorityLadderLevel: "content",
          withinEnvelope: true,
        }),
      }),
    );
  });

  it("never turns an audit-write failure into a denial", async () => {
    const { hook } = makeHook({
      recordShadow: vi.fn().mockRejectedValue(new Error("audit sink down")),
      loadRoom: vi.fn().mockResolvedValue(gappyRoom()),
    });
    expect(await hook.onPreToolUse?.(event({ workroomId: "WC-TEST0002" }))).toMatchObject({
      decision: "allow",
    });
  });

  it("fails open when the room loader throws, even in enforce mode", async () => {
    const { hook } = makeHook({
      mode: "enforce",
      loadRoom: vi.fn().mockRejectedValue(new Error("db unavailable")),
    });
    expect(await hook.onPreToolUse?.(event({ workroomId: "WC-TEST0001" }))).toEqual({
      decision: "allow",
    });
  });
});

// EP-WORK-POSTURE (BI-06C41FDC) — the room's posture GOVERNS the turn.
//
// Before this, the hook computed `decisionMode` and only put it in the shadow
// verdict; it never affected the decision. A room could say "advise only" and a
// consequential tool call would proceed anyway. These tests are the difference
// between a recorded intention and an enforced one.
describe("posture governs the turn", () => {
  const ADVISE_CLAIM = [
    { workroomPosture: { actionBoundary: "advise" }, recordedAt: "2026-08-23T00:00:00.000Z" },
  ];

  it("DENIES a consequential call in an advise-only room, under enforce", async () => {
    const { hook } = makeHook({
      mode: "enforce",
      loadRoom: vi.fn().mockResolvedValue(fullyStaffedRoom(ADVISE_CLAIM)),
    });
    const decision = await hook.onPreToolUse!(event({ workroomId: "room-row-1" }));
    expect(decision).toBeDefined();
    expect(decision!.decision).toBe("deny");
    expect(decision!.reason).toMatch(/advise-only/i);
    // Named for the operator, not a generic refusal.
    expect(decision!.reason).toMatch(/BI-06C41FDC/);
  });

  it("still ALLOWS in shadow mode — the gate mode remains authoritative", async () => {
    const { hook } = makeHook({
      mode: "shadow",
      loadRoom: vi.fn().mockResolvedValue(fullyStaffedRoom(ADVISE_CLAIM)),
    });
    const decision = await hook.onPreToolUse!(event({ workroomId: "room-row-1" }));
    expect(decision).toBeDefined();
    expect(decision!.decision).toBe("allow");
  });

  it("records WHICH ladder constrained the turn", async () => {
    const { hook, deps } = makeHook({
      mode: "shadow",
      loadRoom: vi.fn().mockResolvedValue(fullyStaffedRoom(ADVISE_CLAIM)),
    });
    await hook.onPreToolUse!(event({ workroomId: "room-row-1" }));
    const verdict = (deps.recordShadow as ReturnType<typeof vi.fn>).mock.calls[0][0].verdict;
    expect(verdict.postureActionBoundary).toBe("advise");
    expect(verdict.autonomyConstrainedBy).toBe("posture");
    expect(verdict.decisionMode).toBe("shadow-only");
  });

  it("a room with no declared posture falls back to the shape's own boundary", async () => {
    // change-consequential carries `propose`, so a consequential call in a room
    // bound against it is never silently autonomous even with nothing declared.
    const { hook, deps } = makeHook({
      mode: "shadow",
      resolveAutonomyLevel: () => "autopilot",
      loadRoom: vi.fn().mockResolvedValue(
        fullyStaffedRoom([
          { workroomShape: "change-consequential", recordedAt: "2026-08-23T00:00:00.000Z" },
        ]),
      ),
    });
    await hook.onPreToolUse!(event({ workroomId: "room-row-1" }));
    const verdict = (deps.recordShadow as ReturnType<typeof vi.fn>).mock.calls[0][0].verdict;
    expect(verdict.shapeSource).toBe("room-claim");
    expect(verdict.postureActionBoundary).toBe("propose");
    // The envelope alone would have allowed autonomous action; the shape capped it.
    expect(verdict.decisionMode).toBe("propose-for-approval");
    expect(verdict.autonomyConstrainedBy).toBe("posture");
  });

  it("a shape that carries no boundary leaves the envelope alone", async () => {
    // specialist-alignment routes a corpus check to a qualified specialist. That
    // says nothing about authority, so it must NOT silently restrict the turn —
    // deriving a boundary from every shape would be inventing constraint.
    const { hook, deps } = makeHook({
      mode: "shadow",
      resolveAutonomyLevel: () => "autopilot",
      loadRoom: vi.fn().mockResolvedValue(
        fullyStaffedRoom([
          { workroomShape: "specialist-alignment", recordedAt: "2026-08-23T00:00:00.000Z" },
        ]),
      ),
    });
    await hook.onPreToolUse!(event({ workroomId: "room-row-1" }));
    const verdict = (deps.recordShadow as ReturnType<typeof vi.fn>).mock.calls[0][0].verdict;
    expect(verdict.postureActionBoundary).toBeNull();
    expect(verdict.autonomyConstrainedBy).toBe("envelope");
    expect(verdict.decisionMode).toBe("autonomous-action");
  });

  it("a room-less call records no posture rather than inventing one", async () => {
    const { hook, deps } = makeHook({ mode: "shadow" });
    await hook.onPreToolUse!(event({}));
    const verdict = (deps.recordShadow as ReturnType<typeof vi.fn>).mock.calls[0][0].verdict;
    expect(verdict.postureActionBoundary).toBeNull();
    expect(verdict.autonomyConstrainedBy).toBe("envelope");
  });

  it("never widens: a preauthorized room cannot lift a propose-level envelope", async () => {
    const { hook, deps } = makeHook({
      mode: "shadow",
      resolveAutonomyLevel: () => "propose",
      loadRoom: vi.fn().mockResolvedValue(
        fullyStaffedRoom([
          {
            workroomPosture: { actionBoundary: "preauthorized" },
            recordedAt: "2026-08-23T00:00:00.000Z",
          },
        ]),
      ),
    });
    await hook.onPreToolUse!(event({ workroomId: "room-row-1" }));
    const verdict = (deps.recordShadow as ReturnType<typeof vi.fn>).mock.calls[0][0].verdict;
    expect(verdict.decisionMode).toBe("propose-for-approval");
  });

  it("applies one room boundary to every participant, while participant envelopes may narrow", async () => {
    const room = fullyStaffedRoom(ADVISE_CLAIM);
    const resolveAutonomyLevel = vi.fn((turn: ToolLifecycleEvent) =>
      turn.context?.agentId === "agent-autopilot" ? "autopilot" : "shadow",
    );
    const { hook, deps } = makeHook({
      mode: "shadow",
      loadRoom: vi.fn().mockResolvedValue(room),
      resolveAutonomyLevel,
    });

    await hook.onPreToolUse!(
      event({ workroomId: "room-row-1", agentId: "agent-autopilot" }),
    );
    await hook.onPreToolUse!(
      event({ workroomId: "room-row-1", agentId: "agent-shadow" }),
    );

    const verdicts = (deps.recordShadow as ReturnType<typeof vi.fn>).mock.calls.map(
      ([record]) => record.verdict,
    );
    expect(verdicts.map((verdict) => verdict.postureActionBoundary)).toEqual([
      "advise",
      "advise",
    ]);
    expect(verdicts.map((verdict) => verdict.decisionMode)).toEqual([
      "shadow-only",
      "shadow-only",
    ]);
  });
});

describe("verification governs consequential stake work", () => {
  it("denies by name in enforce mode when an outward action has no passing receipt", async () => {
    const room = { ...fullyStaffedRoom(), verificationEvidence: [] };
    const { hook, deps } = makeHook({
      mode: "enforce",
      loadRoom: vi.fn().mockResolvedValue(room),
    });

    const decision = await hook.onPreToolUse!(event({ workroomId: "room-row-1" }));

    expect(decision).toMatchObject({ decision: "deny" });
    expect(decision?.reason).toContain("missing_verification_evidence");
    expect(deps.recordShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: expect.objectContaining({
          verificationRequired: true,
          verificationSatisfied: false,
          postureVerificationDepth: null,
        }),
      }),
    );
  });

  it("allows the same outward action when the room has a passing receipt", async () => {
    const { hook } = makeHook({ mode: "enforce" });
    expect(await hook.onPreToolUse!(event({ workroomId: "room-row-1" }))).toEqual({
      decision: "allow",
    });
  });

  it("keeps shadow mode audit-only even when verification is missing", async () => {
    const room = { ...fullyStaffedRoom(), verificationEvidence: [] };
    const { hook } = makeHook({
      mode: "shadow",
      loadRoom: vi.fn().mockResolvedValue(room),
    });
    expect(await hook.onPreToolUse!(event({ workroomId: "room-row-1" }))).toMatchObject({
      decision: "allow",
    });
  });

  it("does not add a verification requirement to a legacy consequential tool with no stake consequence", async () => {
    const room = { ...fullyStaffedRoom(), verificationEvidence: [] };
    const { hook, deps } = makeHook({
      mode: "enforce",
      findTool: vi.fn().mockReturnValue({ sideEffect: true, consequence: undefined }),
      loadRoom: vi.fn().mockResolvedValue(room),
    });
    expect(
      await hook.onPreToolUse!(
        event({ workroomId: "room-row-1", toolName: "transition_employee_status" }),
      ),
    ).toEqual({ decision: "allow" });
    expect(deps.recordShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: expect.objectContaining({ verificationRequired: false }),
      }),
    );
  });
});
