import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_VERIFICATION_SHAPE_KEY,
  ACCEPTANCE_VERIFICATION_SHAPE_REF,
  ACCEPTANCE_VERIFIER_ROLE,
  ACCEPTANCE_VERIFIER_WRITE_GRANTS,
  ACCEPTANCE_VERIFIER_WRITES,
} from "./acceptance-verification-shape";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { roomAuthorizesTool, roomGrantsFromWorkShape } from "./room-turn-authority";
import { getWorkShape, isStandingWorkShape, validateWorkShape } from "./work-shapes";

describe("acceptance-verification work shape (BI-C1781121)", () => {
  it("is registered, conforms to §8.11 and is not standing work", () => {
    const shape = getWorkShape(ACCEPTANCE_VERIFICATION_SHAPE_KEY);
    expect(shape).not.toBeNull();
    expect(`${shape!.key}@${shape!.version}`).toBe(ACCEPTANCE_VERIFICATION_SHAPE_REF);
    expect(validateWorkShape(shape!)).toEqual([]);
    expect(isStandingWorkShape(ACCEPTANCE_VERIFICATION_SHAPE_KEY)).toBe(false);
  });

  it("has one non-governed stage answered by the room-bound verifier role, completed by an acceptance receipt", () => {
    const shape = getWorkShape(ACCEPTANCE_VERIFICATION_SHAPE_KEY)!;
    expect(shape.stages).toHaveLength(1);
    const [stage] = shape.stages;
    expect(stage!.accountablePrincipalRef).toBe(`role:${ACCEPTANCE_VERIFIER_ROLE}`);
    expect(stage!.advance.kind).toBe("status-change");
    expect(stage!.evidence).toEqual(["acceptance-receipt"]);
  });

  it("declares exactly the evidence writes the route prompt instructs, and never the packet-bound initiative writer", () => {
    const [stage] = getWorkShape(ACCEPTANCE_VERIFICATION_SHAPE_KEY)!.stages;
    expect(stage!.mandatedTools).toEqual(ACCEPTANCE_VERIFIER_WRITES);
    expect(ACCEPTANCE_VERIFIER_WRITES).toEqual(["record_execution_evidence", "record_workroom_evidence"]);
    expect(ACCEPTANCE_VERIFIER_WRITES).not.toContain("record_initiative_evidence");
  });

  it("its room grants admit exactly the declared writes and no other write (GPP C-2)", () => {
    const shape = getWorkShape(ACCEPTANCE_VERIFICATION_SHAPE_KEY)!;
    expect([...ACCEPTANCE_VERIFIER_WRITE_GRANTS].sort()).toEqual(
      [...new Set(ACCEPTANCE_VERIFIER_WRITES.flatMap((tool) => TOOL_TO_GRANTS[tool] ?? []))].sort(),
    );
    const roomGrants = roomGrantsFromWorkShape(shape.grants);
    for (const tool of ACCEPTANCE_VERIFIER_WRITES) expect(roomAuthorizesTool(tool, roomGrants)).toBe(true);
    expect(roomAuthorizesTool("update_backlog_item_status", roomGrants)).toBe(false);
    expect(roomAuthorizesTool("record_initiative_evidence", roomGrants)).toBe(false);
  });
});
