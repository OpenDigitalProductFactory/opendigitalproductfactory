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
