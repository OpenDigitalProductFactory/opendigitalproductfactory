import { describe, expect, it } from "vitest";

import {
  WORK_CASE_ARCHITECTURE_ALLOCATIONS,
  WORK_CASE_ARCHITECTURE_ELEMENTS,
  getWorkCaseRequirementVerificationPairs,
} from "./architecture-grounding";

describe("Work Case architecture grounding manifest", () => {
  it("allocates every Wave 0 work-management source file into the EA/SysML graph", () => {
    const allocatedFiles = new Set(
      WORK_CASE_ARCHITECTURE_ALLOCATIONS.map((allocation) => allocation.targetRef),
    );

    expect(allocatedFiles).toEqual(
      new Set([
        "apps/web/lib/work-management/case-types.ts",
        "apps/web/lib/work-management/source-registry.ts",
        "apps/web/lib/work-management/status-projection.ts",
        "apps/web/lib/work-management/case-read-model.ts",
        "apps/web/lib/work-management/architecture-grounding.ts",
      ]),
    );
  });

  it("uses SysML allocation vocabulary without requiring new modeling tables", () => {
    expect(
      WORK_CASE_ARCHITECTURE_ALLOCATIONS.every(
        (allocation) =>
          allocation.relationshipType === "sysml_allocates" &&
          allocation.targetKind === "source_file",
      ),
    ).toBe(true);
  });

  it("keeps every requirement paired with a verification case", () => {
    const pairs = getWorkCaseRequirementVerificationPairs();
    const requirementIds = WORK_CASE_ARCHITECTURE_ELEMENTS
      .filter((element) => element.elementType === "requirement")
      .map((element) => element.elementId)
      .sort();

    expect(pairs.map((pair) => pair.requirementId).sort()).toEqual(requirementIds);
    expect(pairs.every((pair) => pair.verificationCaseId.startsWith("VC-WC-"))).toBe(true);
  });

  it("anchors the Wave 0 slice to IT4IT streams already supported by the EA substrate", () => {
    const validStreams = new Set(["operate", "consume", "integrate", "deploy", "release"]);

    for (const element of WORK_CASE_ARCHITECTURE_ELEMENTS) {
      expect(element.itValueStreams.length).toBeGreaterThan(0);
      expect(element.itValueStreams.every((stream) => validStreams.has(stream))).toBe(true);
    }
  });
});
