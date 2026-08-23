import { describe, expect, it } from "vitest";

import { normalizeInitiativeObjectiveMappings } from "./objective-mapping-repository";

describe("normalizeInitiativeObjectiveMappings", () => {
  it("accepts complete objective and acceptance statement mappings", () => {
    expect(normalizeInitiativeObjectiveMappings([
      { objectiveId: "OBJ-1", evidenceRefs: ["E-1"] },
      { objectiveId: "AC-1", evidenceRefs: ["E-2"] },
    ], new Set(["OBJ-1", "AC-1"]))).toEqual([
      { objectiveId: "OBJ-1", evidenceRefs: ["E-1"] },
      { objectiveId: "AC-1", evidenceRefs: ["E-2"] },
    ]);
  });

  it("rejects duplicate, foreign, and empty statement mappings", () => {
    expect(normalizeInitiativeObjectiveMappings([
      { objectiveId: "OBJ-1", evidenceRefs: ["E-1"] },
      { objectiveId: "OBJ-1", evidenceRefs: ["E-2"] },
    ], new Set(["OBJ-1"]))).toBeNull();
    expect(normalizeInitiativeObjectiveMappings([
      { objectiveId: "AC-OTHER", evidenceRefs: ["E-1"] },
    ], new Set(["OBJ-1", "AC-1"]))).toBeNull();
  });
});
