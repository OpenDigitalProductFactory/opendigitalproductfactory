import { describe, expect, it } from "vitest";

import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import {
  admitWorktreeProvision,
  worktreeProvisionRefusal,
} from "@/lib/work-capsules/worktree-provision-admission";
import { refuseUnlessAdoptionProvisions, refuseUnlessRoomProvisions } from "@/lib/work-capsules/worktree-provision-gate";
import { DELIVERY_SHAPE_REFS } from "@/lib/work-management/delivery-shapes";
import { roomAuthorizesTool, roomGrantsFromWorkShape } from "@/lib/work-management/room-turn-authority";
import {
  SOURCE_INQUIRY_READ_TOOLS,
  SOURCE_INQUIRY_SHAPE_KEY,
  SOURCE_INQUIRY_SHAPE_REF,
} from "@/lib/work-management/source-inquiry-shape";
import { getWorkShape, validateWorkShape } from "@/lib/work-management/work-shapes";

// GPP reach test for worktree provisioning (BI-D1FB8C4D, AC-WPG-1, AC-WPG-2).
// A read-only source-inquiry room must not reach worktree provisioning from
// either path: the in-portal room turn (roomAuthorizesTool) or an external MCP
// caller (the handler admission, which no room authority reaches otherwise).

const PROVISIONING_TOOLS = [
  "plan_workroom_worktree",
  "plan_capsule_worktree",
  "claim_workroom_scope",
  "claim_capsule_scope",
  "adopt_worktree",
] as const;

const inquiry = getWorkShape(SOURCE_INQUIRY_SHAPE_KEY)!;
const inquirySurface = roomGrantsFromWorkShape(inquiry.grants);

function roomDb(rows: Array<{ capsuleId: string; scopeClaims: unknown; headBranch?: string; executorRef?: string }>) {
  return {
    workroom: {
      findFirst: async (args: unknown) => {
        const where = (args as { where: Record<string, unknown> }).where;
        return rows.find((row) => (where.capsuleId ? row.capsuleId === where.capsuleId : row.headBranch === where.headBranch)) ?? null;
      },
      findMany: async (args: unknown) => {
        const where = (args as { where: Record<string, unknown> }).where;
        return rows.filter((row) => row.executorRef === where.executorRef);
      },
    },
  };
}

const shaped = (ref: string) => [{ workShape: ref }];

describe("source-inquiry@1.0.0 is a valid read-only shape (AC-WPG-1)", () => {
  it("is registered, valid, and grants tool:read only", () => {
    expect(inquiry).toBeTruthy();
    expect(validateWorkShape(inquiry)).toEqual([]);
    expect(inquiry.grants).toEqual(["tool:read"]);
  });

  it("every stage declares only the source-read tools, and the room reaches them", () => {
    for (const stage of inquiry.stages) {
      expect(stage.tools).toEqual(SOURCE_INQUIRY_READ_TOOLS);
      for (const tool of stage.tools ?? []) expect(roomAuthorizesTool(tool, inquirySurface), tool).toBe(true);
    }
  });
});

describe("a source-inquiry room cannot reach worktree provisioning (AC-WPG-2)", () => {
  it.each(PROVISIONING_TOOLS)("in-portal: %s is outside the room surface", (tool) => {
    expect(TOOL_TO_GRANTS[tool], tool).toBeDefined();
    expect(roomAuthorizesTool(tool, inquirySurface)).toBe(false);
  });

  it("the admission refuses the room, and the refusal names the source-read tools", () => {
    const admission = admitWorktreeProvision([{ capsuleId: "WC-INQUIRY", workShapeRef: SOURCE_INQUIRY_SHAPE_REF }]);
    expect(admission).toEqual({
      admitted: false,
      code: "worktree_provision_not_admitted",
      capsuleId: "WC-INQUIRY",
      workShapeRef: SOURCE_INQUIRY_SHAPE_REF,
    });
    if (admission.admitted) return;
    const refusal = worktreeProvisionRefusal(admission, "plan_workroom_worktree");
    expect(refusal.error).toBe("worktree_provision_not_admitted");
    for (const tool of SOURCE_INQUIRY_READ_TOOLS) expect(refusal.message).toContain(tool);
  });

  it.each(["plan_workroom_worktree", "claim_workroom_scope"])("external: %s on a source-inquiry room is refused", async (tool) => {
    const db = roomDb([{ capsuleId: "WC-INQUIRY", scopeClaims: shaped(SOURCE_INQUIRY_SHAPE_REF) }]);
    const refusal = await refuseUnlessRoomProvisions(db, "WC-INQUIRY", tool);
    expect(refusal?.error).toBe("worktree_provision_not_admitted");
  });

  it("external: adopt_worktree is refused when the caller's session holds a source-inquiry room", async () => {
    const db = roomDb([{ capsuleId: "WC-INQUIRY", scopeClaims: shaped(SOURCE_INQUIRY_SHAPE_REF), executorRef: "session-1" }]);
    const refusal = await refuseUnlessAdoptionProvisions(db, {
      repositoryFullName: "o/r", headBranch: "feat/new", sessionRef: "session-1", requestedWorkShape: null,
    }, "adopt_worktree");
    expect(refusal?.error).toBe("worktree_provision_not_admitted");
  });

  it("external: adopt_worktree is refused when it asks the new room to be source-inquiry", async () => {
    const refusal = await refuseUnlessAdoptionProvisions(roomDb([]), {
      repositoryFullName: "o/r", headBranch: "feat/new", sessionRef: null, requestedWorkShape: SOURCE_INQUIRY_SHAPE_REF,
    }, "adopt_worktree");
    expect(refusal?.error).toBe("worktree_provision_not_admitted");
  });
});

describe("delivery and unshaped rooms keep provisioning", () => {
  it.each(DELIVERY_SHAPE_REFS.filter((ref) => !ref.startsWith("delivery-xlarge@")))("%s admits provisioning", (ref) => {
    expect(admitWorktreeProvision([{ capsuleId: "WC-D", workShapeRef: ref }])).toEqual({ admitted: true, unshaped: false });
  });

  it("an unshaped room is admitted and reported as unshaped", () => {
    expect(admitWorktreeProvision([{ capsuleId: "WC-U", workShapeRef: null }])).toEqual({ admitted: true, unshaped: true });
  });

  it("an unknown shape ref fails closed", () => {
    const admission = admitWorktreeProvision([{ capsuleId: "WC-X", workShapeRef: "no-such-shape@9.9.9" }]);
    expect(admission).toMatchObject({ admitted: false, code: "unknown_work_shape" });
  });

  it("external: a delivery session adopting a new branch is admitted", async () => {
    const db = roomDb([{ capsuleId: "WC-D", scopeClaims: shaped("delivery-medium@1.0.0"), executorRef: "session-2" }]);
    expect(await refuseUnlessAdoptionProvisions(db, {
      repositoryFullName: "o/r", headBranch: "feat/new", sessionRef: "session-2", requestedWorkShape: null,
    }, "adopt_worktree")).toBeNull();
  });
});
