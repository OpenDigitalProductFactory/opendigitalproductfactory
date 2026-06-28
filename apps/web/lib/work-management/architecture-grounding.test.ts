import { describe, expect, it } from "vitest";

import {
  WORK_CASE_ARCHITECTURE_ALLOCATIONS,
  WORK_CASE_ARCHITECTURE_ELEMENTS,
  getWorkCaseRequirementVerificationPairs,
  type WorkCaseArchitectureElement,
} from "./architecture-grounding";
import { WORK_CASE_ACTION_VERBS } from "./case-types";

const elementById = new Map<string, WorkCaseArchitectureElement>(
  WORK_CASE_ARCHITECTURE_ELEMENTS.map((element) => [element.elementId, element]),
);

describe("Work Case architecture grounding manifest", () => {
  it("allocates every Wave 0, Wave 1, and Wave 2 work-management source file into the EA/SysML graph", () => {
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
        "apps/web/lib/work-management/action-registry.ts",
        "apps/web/lib/work-management/policy-envelope.ts",
        "apps/web/lib/work-management/receipt-envelope.ts",
        "apps/web/lib/work-management/receipt-coverage.ts",
        "apps/web/lib/work-management/case-telemetry.ts",
        "apps/web/lib/work-management/work-case-governance-hook.ts",
        "apps/web/lib/work-management/accountability.ts",
        "apps/web/lib/work-management/staged-transition.ts",
        "apps/web/lib/work-management/stop-conditions.ts",
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

  it("grounds Wave 1 requirements in implemented or partially implemented verification cases", () => {
    for (const requirementId of ["REQ-WC-1", "REQ-WC-2"]) {
      const requirement = elementById.get(requirementId);
      expect(requirement?.implementationStatus).toMatch(/^(implemented|partially-implemented)$/);

      const verificationCase = elementById.get(requirement?.verificationCaseId ?? "");
      expect(verificationCase?.elementType).toBe("verification_case");
      expect(verificationCase?.implementationStatus).toMatch(
        /^(implemented|partially-implemented)$/,
      );
    }
  });

  it("grounds Wave 2 accountability in implemented verification cases", () => {
    const requirement = elementById.get("REQ-WC-3");
    expect(requirement?.implementationStatus).toMatch(/^(implemented|partially-implemented)$/);

    const verificationCase = elementById.get(requirement?.verificationCaseId ?? "");
    expect(verificationCase?.elementType).toBe("verification_case");
    expect(verificationCase?.implementationStatus).toMatch(
      /^(implemented|partially-implemented)$/,
    );
  });

  it("declares EA Action elements for the Work Case handoff grammar", () => {
    const actionIds = WORK_CASE_ARCHITECTURE_ELEMENTS
      .filter((element) => element.elementType === "action")
      .map((element) => element.elementId);

    expect(actionIds).toEqual(
      expect.arrayContaining(
        WORK_CASE_ACTION_VERBS.map((action) => `ACT-WC-${action}`),
      ),
    );
  });

  it("anchors the Wave 0 slice to IT4IT streams already supported by the EA substrate", () => {
    const validStreams = new Set(["operate", "consume", "integrate", "deploy", "release"]);

    for (const element of WORK_CASE_ARCHITECTURE_ELEMENTS) {
      expect(element.itValueStreams.length).toBeGreaterThan(0);
      expect(element.itValueStreams.every((stream) => validStreams.has(stream))).toBe(true);
    }
  });
});
