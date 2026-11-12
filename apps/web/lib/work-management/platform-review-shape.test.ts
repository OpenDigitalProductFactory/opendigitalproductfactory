import { describe, expect, it } from "vitest";

import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import {
  PLATFORM_ARCHITECTURE_REVIEW_SHAPE_KEY,
  PLATFORM_ARCHITECTURE_REVIEW_WRITE_GRANTS,
  PLATFORM_ARCHITECTURE_REVIEW_WRITES,
  PLATFORM_DESIGN_REVIEW_SHAPE_KEY,
  PLATFORM_DESIGN_REVIEW_WRITE_GRANTS,
  PLATFORM_DESIGN_REVIEW_WRITES,
  PLATFORM_REVIEW_SHAPE_KEY,
  PLATFORM_REVIEW_SHAPE_REF,
  PLATFORM_REVIEW_WRITE_GRANTS,
  PLATFORM_REVIEW_WRITES,
  PLATFORM_REVIEWER_ROLE,
} from "./platform-review-shape";
import { roomStageMandatedTools } from "./room-stage-mandate";
import { roomAuthorizesTool, roomGrantsFromWorkShape } from "./room-turn-authority";
import { getWorkShape, isStandingWorkShape, validateWorkShape } from "./work-shapes";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "./workroom-shape-claim";

describe("platform post-implementation review shape (BI-AA47C672)", () => {
  it("is registered, conforms to §8.11 and is finite work", () => {
    const shape = getWorkShape(PLATFORM_REVIEW_SHAPE_KEY);
    expect(shape).not.toBeNull();
    expect(`${shape!.key}@${shape!.version}`).toBe(PLATFORM_REVIEW_SHAPE_REF);
    expect(validateWorkShape(shape!)).toEqual([]);
    expect(isStandingWorkShape(PLATFORM_REVIEW_SHAPE_KEY)).toBe(false);
  });

  it("has one non-governed stage answered by the room-bound reviewer role, completed by a PIR receipt", () => {
    const [stage, ...rest] = getWorkShape(PLATFORM_REVIEW_SHAPE_KEY)!.stages;
    expect(rest).toEqual([]);
    expect(stage!.accountablePrincipalRef).toBe(`role:${PLATFORM_REVIEWER_ROLE}`);
    expect(stage!.advance.kind).toBe("status-change");
    expect(stage!.evidence).toEqual(["pir-receipt"]);
    expect(stage!.mandatedTools).toEqual(["record_initiative_post_implementation_review", "record_workroom_evidence"]);
  });

  it("its room grants admit exactly the declared writes and no other write (GPP C-2)", () => {
    const shape = getWorkShape(PLATFORM_REVIEW_SHAPE_KEY)!;
    expect([...PLATFORM_REVIEW_WRITE_GRANTS].sort()).toEqual(
      [...new Set(PLATFORM_REVIEW_WRITES.flatMap((tool) => TOOL_TO_GRANTS[tool] ?? []))].sort(),
    );
    const roomGrants = roomGrantsFromWorkShape(shape.grants);
    for (const tool of PLATFORM_REVIEW_WRITES) expect(roomAuthorizesTool(tool, roomGrants)).toBe(true);
    expect(roomAuthorizesTool("read_source_at_version", roomGrants)).toBe(true);
    expect(roomAuthorizesTool("update_backlog_item_status", roomGrants)).toBe(false);
  });

  it("mandates the review writer only to the reviewer the room binds, on the room's own drive task", () => {
    const room = { capsuleId: "WC-PIR-1", status: "working", archivedAt: null,
      scopeClaims: [buildWorkShapeClaim(PLATFORM_REVIEW_SHAPE_REF), buildWorkShapeRoleBindingsClaim({ [PLATFORM_REVIEWER_ROLE]: "agent:AGT-WS-REVIEW" })] };
    const scheduledTaskId = `workroom-WC-PIR-1-${PLATFORM_REVIEW_SHAPE_KEY}`;
    expect(roomStageMandatedTools({ scheduledTaskId, room, agentIds: ["AGT-WS-REVIEW"] })).toEqual([...PLATFORM_REVIEW_WRITES].sort());
    expect(roomStageMandatedTools({ scheduledTaskId, room, agentIds: ["AGT-OTHER"] })).toEqual([]);
    expect(roomStageMandatedTools({ scheduledTaskId: "workroom-WC-PIR-2-x", room, agentIds: ["AGT-WS-REVIEW"] })).toEqual([]);
  });
});

describe("platform design-stage review shapes (BI-9CCB88C4)", () => {
  it("registers the design-review sibling with the design writer and spec-approval receipt", () => {
    const shape = getWorkShape(PLATFORM_DESIGN_REVIEW_SHAPE_KEY);
    expect(shape).not.toBeNull();
    expect(validateWorkShape(shape!)).toEqual([]);
    expect(isStandingWorkShape(PLATFORM_DESIGN_REVIEW_SHAPE_KEY)).toBe(false);
    expect(shape!.stages[0]!.evidence).toEqual(["spec-approval-receipt"]);
    expect(shape!.stages[0]!.mandatedTools).toEqual(["record_initiative_design_review", "record_workroom_evidence"]);
    expect([...PLATFORM_DESIGN_REVIEW_WRITE_GRANTS].sort()).toEqual(
      [...new Set(PLATFORM_DESIGN_REVIEW_WRITES.flatMap((tool) => TOOL_TO_GRANTS[tool] ?? []))].sort(),
    );
  });

  it("registers the architecture-review sibling with its lane grant", () => {
    const shape = getWorkShape(PLATFORM_ARCHITECTURE_REVIEW_SHAPE_KEY);
    expect(shape).not.toBeNull();
    expect(validateWorkShape(shape!)).toEqual([]);
    expect(shape!.stages[0]!.evidence).toEqual(["architecture-review-receipt"]);
    expect(shape!.stages[0]!.mandatedTools).toEqual(["record_initiative_architecture_review", "record_workroom_evidence"]);
    expect([...PLATFORM_ARCHITECTURE_REVIEW_WRITE_GRANTS].sort()).toEqual(
      [...new Set(PLATFORM_ARCHITECTURE_REVIEW_WRITES.flatMap((tool) => TOOL_TO_GRANTS[tool] ?? []))].sort(),
    );
  });
});
