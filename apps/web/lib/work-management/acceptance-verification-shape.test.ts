import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_VERIFICATION_SHAPE_KEY,
  ACCEPTANCE_VERIFICATION_SHAPE_REF,
  ACCEPTANCE_VERIFIER_EVIDENCE_WRITES,
  ACCEPTANCE_VERIFIER_ROLE,
  ACCEPTANCE_VERIFIER_WRITE_GRANTS,
  ACCEPTANCE_VERIFIER_WRITES,
} from "./acceptance-verification-shape";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { roomAuthorizesTool, roomGrantsFromWorkShape } from "./room-turn-authority";
import { getWorkShape, getWorkShapeVersion, isStandingWorkShape, validateWorkShape } from "./work-shapes";

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

  it("declares the evidence writes and the packet-bound objective-mapping writer the platform issues the room (BI-099A0BA3)", () => {
    const [stage] = getWorkShape(ACCEPTANCE_VERIFICATION_SHAPE_KEY)!.stages;
    expect(stage!.mandatedTools).toEqual(ACCEPTANCE_VERIFIER_WRITES);
    expect(ACCEPTANCE_VERIFIER_EVIDENCE_WRITES).toEqual(["record_execution_evidence", "record_workroom_evidence"]);
    expect(ACCEPTANCE_VERIFIER_WRITES).toEqual(["record_execution_evidence", "record_workroom_evidence", "record_initiative_evidence"]);
  });

  it("its room grants admit exactly the declared writes and no other write (GPP C-2)", () => {
    const shape = getWorkShape(ACCEPTANCE_VERIFICATION_SHAPE_KEY)!;
    expect([...ACCEPTANCE_VERIFIER_WRITE_GRANTS].sort()).toEqual(
      [...new Set(ACCEPTANCE_VERIFIER_WRITES.flatMap((tool) => TOOL_TO_GRANTS[tool] ?? []))].sort(),
    );
    const roomGrants = roomGrantsFromWorkShape(shape.grants);
    for (const tool of ACCEPTANCE_VERIFIER_WRITES) expect(roomAuthorizesTool(tool, roomGrants)).toBe(true);
    expect(roomAuthorizesTool("update_backlog_item_status", roomGrants)).toBe(false);
    expect(roomAuthorizesTool("record_initiative_design_review", roomGrants)).toBe(false);
  });
});

describe("acceptance-verification shape versions (BI-099A0BA3, security review L2)", () => {
  it("is 1.1.0 now that the verify stage writes the objective mapping", () => {
    expect(ACCEPTANCE_VERIFICATION_SHAPE_REF).toBe("acceptance-verification@1.1.0");
  });

  it("keeps 1.0.0 resolvable, frozen as shipped, for rooms already pinned to it", () => {
    const prior = getWorkShapeVersion(ACCEPTANCE_VERIFICATION_SHAPE_KEY, "1.0.0");
    expect(prior).not.toBeNull();
    expect(validateWorkShape(prior!)).toEqual([]);
    expect(prior!.stages[0]!.mandatedTools).toEqual(["record_execution_evidence", "record_workroom_evidence"]);
    expect(prior!.grants).toEqual(["tool:read", "build_evidence", "workroom_evidence_write"]);
  });
});
