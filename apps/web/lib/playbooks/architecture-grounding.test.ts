import { describe, expect, it } from "vitest";

import {
  GOVERNED_ADAPTIVE_PLAYBOOKS_GROUNDING,
  findGovernedAdaptivePlaybookElement,
} from "./architecture-grounding";

describe("governed adaptive playbooks architecture grounding", () => {
  it("registers the observer action and verification case with code allocations", () => {
    const action = findGovernedAdaptivePlaybookElement("ACT-GAP-observe");
    const verification = findGovernedAdaptivePlaybookElement("VC-GAP-observer");

    expect(action).toMatchObject({
      elementId: "ACT-GAP-observe",
      elementType: "action",
      implementationStatus: "implemented",
      itValueStreams: ["operate"],
      verificationCaseId: "VC-GAP-observer",
    });
    expect(action?.sysml_allocates).toEqual(
      expect.arrayContaining([
        "apps/web/lib/tak/pattern-observer/observer.ts",
        "apps/web/lib/tak/pattern-observer/classifiers.ts",
        "apps/web/lib/tak/pattern-observer/core.ts",
      ]),
    );
    expect(verification).toMatchObject({
      elementId: "VC-GAP-observer",
      elementType: "verification_case",
      implementationStatus: "implemented",
      itValueStreams: ["operate"],
    });
    expect(verification?.sysml_allocates).toContain(
      "apps/web/lib/tak/pattern-observer/observer.test.ts",
    );
  });

  it("marks only tested Slice 1 observer behavior implemented", () => {
    expect(findGovernedAdaptivePlaybookElement("REQ-GAP-slice-1-observer")).toMatchObject({
      elementType: "requirement",
      implementationStatus: "implemented",
      verificationCaseId: "VC-GAP-observer",
    });
    expect(findGovernedAdaptivePlaybookElement("SM-GAP-PROMOTION")).toMatchObject({
      elementType: "state_machine",
      implementationStatus: "planned",
    });
  });

  it("keeps every manifest element grounded in IT4IT operate", () => {
    expect(GOVERNED_ADAPTIVE_PLAYBOOKS_GROUNDING).not.toHaveLength(0);
    expect(
      GOVERNED_ADAPTIVE_PLAYBOOKS_GROUNDING.every((element) =>
        element.itValueStreams.includes("operate"),
      ),
    ).toBe(true);
  });
});
