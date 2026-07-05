import { describe, expect, it } from "vitest";
import { deriveAutoBriefFromDesignDoc } from "./derive-auto-brief";

describe("deriveAutoBriefFromDesignDoc", () => {
  // Regression (BI-4E84841D): the auto-populated brief hardcoded
  // portfolioContext="manufacturing_and_delivery" and
  // targetRoles=["admin","customer"], which surfaced verbatim in the Feature
  // Brief of an internal Build Studio meta-feature. The derivation must never
  // fabricate audience/ownership — honest blanks degrade gracefully downstream.
  it("never fabricates portfolio or roles when the designDoc has none", () => {
    const brief = deriveAutoBriefFromDesignDoc({ problemStatement: "Fix the build list" }, "Build list tweak");
    expect(brief.portfolioContext).toBe("");
    expect(brief.targetRoles).toEqual([]);
  });

  it("never fabricates anything from a null designDoc", () => {
    const brief = deriveAutoBriefFromDesignDoc(null, "My build");
    expect(brief).toEqual({
      title: "My build",
      description: "My build",
      portfolioContext: "",
      targetRoles: [],
      inputs: [],
      dataNeeds: "",
      acceptanceCriteria: [],
    });
  });

  it("carries doc-provided roles and acceptance criteria through unchanged", () => {
    const brief = deriveAutoBriefFromDesignDoc(
      {
        problemStatement: "Operators cannot see build freshness",
        proposedApproach: "Add a relative timestamp",
        targetRoles: ["platform operator"],
        acceptanceCriteria: ["Timestamp renders as a RELATIVE time, e.g. '3m ago' — not an absolute date"],
      },
      "Relative build timestamps",
    );
    expect(brief.targetRoles).toEqual(["platform operator"]);
    expect(brief.acceptanceCriteria).toEqual([
      "Timestamp renders as a RELATIVE time, e.g. '3m ago' — not an absolute date",
    ]);
    expect(brief.description).toBe("Operators cannot see build freshness");
    expect(brief.dataNeeds).toBe("Add a relative timestamp");
  });

  it("drops blank entries instead of persisting them", () => {
    const brief = deriveAutoBriefFromDesignDoc(
      { targetRoles: ["admin", "  ", ""], acceptanceCriteria: ["", "works"] },
      "T",
    );
    expect(brief.targetRoles).toEqual(["admin"]);
    expect(brief.acceptanceCriteria).toEqual(["works"]);
  });

  it("falls back to the build title when problemStatement is blank", () => {
    const brief = deriveAutoBriefFromDesignDoc({ problemStatement: "   " }, "Fallback title");
    expect(brief.description).toBe("Fallback title");
  });
});
