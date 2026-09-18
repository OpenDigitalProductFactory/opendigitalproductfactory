// BI-12A083B4 — the wiring proof. drive-conclusion.test.ts proves the classifier;
// this proves the DRIVE records its answer, so a stop that concluded nothing
// cannot reach the database as quiet.
import { describe, expect, it, vi } from "vitest";

import { workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";

import {
  applyDrivePlan,
  type WorkroomDriveEffects,
  type WorkroomDriveRoom,
} from "./workroom-drive";

const OWNER: EffectiveHumanAccountability = {
  state: "resolved",
  principalId: "PRN-ACCOUNTABLE",
  source: "inherited-room",
  inheritedFrom: ["WC-ROOM", "WC-PARENT"],
};

function room(): WorkroomDriveRoom {
  return {
    id: "room-row-1",
    capsuleId: "WC-ROOM",
    scopeClaims: [],
    workspaceState: {},
    leaseExpiresAt: null,
    leaseHolderPrincipalId: null,
    ownerUserId: null,
    participants: [],
    currentStageKey: null,
    receipts: [],
    budgetUsage: {},
    stopConditionHits: [],
    reviewDue: false,
  } as unknown as WorkroomDriveRoom;
}

function effects(overrides: Partial<WorkroomDriveEffects> = {}) {
  const persisted: Record<string, unknown>[] = [];
  const fx = {
    persist: vi.fn(async (input: { snapshot: Record<string, unknown> }) => {
      persisted.push(input.snapshot);
    }),
    acquireLease: vi.fn(async () => "acquired" as const),
    upsertAgentTask: vi.fn(async () => {}),
    deactivateAgentTask: vi.fn(async () => {}),
    resolveAccountability: vi.fn(async () => OWNER),
    ...overrides,
  } as unknown as WorkroomDriveEffects & { persist: ReturnType<typeof vi.fn> };
  return { fx, persisted };
}

function plan(action: string, reason: string, extra: Record<string, unknown> = {}) {
  return {
    action,
    reason,
    roomId: "WC-ROOM",
    shapeKey: "obligation-assurance-watch",
    shapeVersion: "1.0.0",
    definition: null,
    stageKey: null,
    accountablePrincipalRef: null,
    agentId: null,
    attentionPrincipalRef: null,
    taskId: workroomDriveTaskId("WC-ROOM", "obligation-assurance-watch"),
    conformance: null,
    cycle: null,
    deviations: [],
    ledger: [reason],
    ...extra,
  } as never;
}

const NOW = new Date("2026-09-12T00:00:00.000Z");

describe("the drive records a conclusion on every tick (AC-CS-01)", () => {
  it("records a blockage with an owner and an unblocking event when a stop concluded nothing", async () => {
    const { fx, persisted } = effects();
    await applyDrivePlan({ room: room(), plan: plan("stop", "unreachable_substrate"), now: NOW, effects: fx });

    const conclusion = persisted[0]?.conclusion as Record<string, unknown>;
    expect(conclusion.kind).toBe("blocked");
    const blockage = conclusion.blockage as Record<string, unknown>;
    expect(blockage.ownerPrincipalId).toBe("PRN-ACCOUNTABLE");
    expect(String(blockage.unblockedBy)).toContain("substrate answers");
  });

  it("records outcome-met when a cycle completes, and asks nobody for an owner", async () => {
    const { fx, persisted } = effects();
    await applyDrivePlan({ room: room(), plan: plan("stop", "success"), now: NOW, effects: fx });

    expect((persisted[0]?.conclusion as Record<string, unknown>).kind).toBe("outcome-met");
    // Resolving accountability walks a lineage; a finished room must not pay for it.
    expect(fx.resolveAccountability).not.toHaveBeenCalled();
  });

  it("does not resolve an owner for a room that is simply quiet", async () => {
    const { fx, persisted } = effects();
    await applyDrivePlan({ room: room(), plan: plan("do_not_wake", "quiet"), now: NOW, effects: fx });

    expect((persisted[0]?.conclusion as Record<string, unknown>).kind).toBe("in-motion");
    expect(fx.resolveAccountability).not.toHaveBeenCalled();
  });

  it("surfaces a defect rather than a silent stop when no owner can be named", async () => {
    const { fx, persisted } = effects({
      resolveAccountability: vi.fn(async () => ({
        state: "setup-required",
        reason: "no-organization-owner-recorded",
        message: "This organization records no owner.",
        atWorkroomId: null,
      })) as never,
    });
    await applyDrivePlan({ room: room(), plan: plan("do_not_wake", "missing_shape"), now: NOW, effects: fx });

    const conclusion = persisted[0]?.conclusion as Record<string, unknown>;
    expect(conclusion.kind).toBe("unconcluded");
    expect(String(conclusion.summary)).toContain("No one can be named to clear it");
  });

  it("a failed accountability read still records the blockage, louder than silence", async () => {
    const { fx, persisted } = effects({
      resolveAccountability: vi.fn(async () => {
        throw new Error("lineage query timed out");
      }) as never,
    });
    await applyDrivePlan({ room: room(), plan: plan("stop", "empty_read"), now: NOW, effects: fx });

    const conclusion = persisted[0]?.conclusion as Record<string, unknown>;
    expect(conclusion.kind).toBe("unconcluded");
    expect(String(conclusion.summary)).toContain("lineage query timed out");
  });

  it("a drive composed without a resolver says so instead of inventing an owner", async () => {
    const { fx, persisted } = effects({ resolveAccountability: undefined });
    await applyDrivePlan({ room: room(), plan: plan("stop", "conformance_stop"), now: NOW, effects: fx });

    const conclusion = persisted[0]?.conclusion as Record<string, unknown>;
    expect(conclusion.kind).toBe("unconcluded");
    expect(String(conclusion.summary)).toContain("accountability resolver");
  });

  it("every persisted tick carries a conclusion, whatever the action", async () => {
    for (const [action, reason] of [
      ["do_not_wake", "no_posture"],
      ["stop", "conformance_stop"],
      ["escalate", "conformance_escalate"],
      ["pause", "conformance_pause"],
    ] as const) {
      const { fx, persisted } = effects();
      await applyDrivePlan({ room: room(), plan: plan(action, reason), now: NOW, effects: fx });
      expect(persisted[0]?.conclusion, `${action}/${reason}`).toBeTruthy();
    }
  });
});
