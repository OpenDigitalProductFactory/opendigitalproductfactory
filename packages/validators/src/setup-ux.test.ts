import { describe, it, expect } from "vitest";
import {
  analyzeSetupSurface,
  isTerseLabel,
  SETUP_UX_CEILINGS,
  setupSurfaceDescriptorSchema,
  type SetupSurfaceDescriptor,
} from "./setup-ux";

function baseDescriptor(over: Partial<SetupSurfaceDescriptor> = {}): SetupSurfaceDescriptor {
  return {
    route: "/storefront",
    text: "Set up your restaurant. Add your menu, tables, and hours.",
    actions: [{ label: "Publish" }, { label: "Edit settings" }],
    ...over,
  };
}

describe("isTerseLabel", () => {
  it("flags stock verbs, glyphs, and 1–2 char controls", () => {
    for (const l of ["Edit", "Del", "On", "Off", "Hide", "Show", "↑", "↓", "×", "x", "Up"]) {
      expect(isTerseLabel(l)).toBe(true);
    }
    expect(isTerseLabel("")).toBe(true);
  });

  it("does not flag a descriptive label", () => {
    expect(isTerseLabel("Remove Coffee Shop line")).toBe(false);
    expect(isTerseLabel("Add menu item")).toBe(false);
  });
});

describe("analyzeSetupSurface", () => {
  it("passes a lean task-first surface", () => {
    const report = analyzeSetupSurface(baseDescriptor());
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("flags a word wall over the ceiling", () => {
    const text = Array.from({ length: SETUP_UX_CEILINGS.maxWords + 50 }, () => "word").join(" ");
    const report = analyzeSetupSurface(baseDescriptor({ text }));
    expect(report.violations.map((v) => v.code)).toContain("word-ceiling");
  });

  it("flags too many actions", () => {
    const actions = Array.from({ length: SETUP_UX_CEILINGS.maxActions + 3 }, (_, i) => ({
      label: `Action ${i}`,
    }));
    const report = analyzeSetupSurface(baseDescriptor({ actions }));
    expect(report.violations.map((v) => v.code)).toContain("action-ceiling");
  });

  it("flags repeated terse labels with no distinguishing accessible name", () => {
    const actions = [
      { label: "Edit" },
      { label: "Edit" },
      { label: "Edit" },
      { label: "Del" },
      { label: "Del" },
      { label: "Del" },
    ];
    const report = analyzeSetupSurface(baseDescriptor({ actions }));
    const codes = report.violations.map((v) => v.code);
    expect(codes).toContain("repeated-terse-label");
    // Both Edit and Del breach → two violations.
    expect(report.violations.filter((v) => v.code === "repeated-terse-label")).toHaveLength(2);
  });

  it("does NOT flag terse visible labels that carry unique accessible names", () => {
    const actions = [
      { label: "Remove", accessibleLabel: "Remove Coffee Shop line" },
      { label: "Remove", accessibleLabel: "Remove Food Truck line" },
      { label: "Remove", accessibleLabel: "Remove Catering line" },
    ];
    const report = analyzeSetupSurface(baseDescriptor({ actions }));
    expect(report.violations.map((v) => v.code)).not.toContain("repeated-terse-label");
  });

  it("flags a long inline option list (101-option service-line select)", () => {
    const report = analyzeSetupSurface(
      baseDescriptor({
        optionGroups: [{ label: "Add service line", optionCount: 101 }],
      }),
    );
    expect(report.violations.map((v) => v.code)).toContain("long-option-exposure");
  });

  it("exempts a long option list that is collapsed until opened", () => {
    const report = analyzeSetupSurface(
      baseDescriptor({
        optionGroups: [
          { label: "Add service line", optionCount: 101, collapsedUntilOpened: true },
        ],
      }),
    );
    expect(report.violations.map((v) => v.code)).not.toContain("long-option-exposure");
  });

  it("flags generated content with no recovery path", () => {
    const report = analyzeSetupSurface(
      baseDescriptor({ recovery: { generatedGroups: 2, recoverableGroups: 1 } }),
    );
    expect(report.violations.map((v) => v.code)).toContain("generated-content-recovery");
  });

  it("passes when every generated group is recoverable", () => {
    const report = analyzeSetupSurface(
      baseDescriptor({ recovery: { generatedGroups: 2, recoverableGroups: 2 } }),
    );
    expect(report.violations.map((v) => v.code)).not.toContain("generated-content-recovery");
  });

  it("reproduces the audited /storefront failure profile", () => {
    // 2026-07-22 audit: ~505 words, 17 actions, 101-option service-line select,
    // generated residue with no recovery.
    const report = analyzeSetupSurface({
      route: "/storefront",
      text: Array.from({ length: 505 }, () => "word").join(" "),
      actions: Array.from({ length: 17 }, (_, i) => ({ label: `Action ${i}` })),
      optionGroups: [{ label: "Add service line", optionCount: 101 }],
      recovery: { generatedGroups: 3, recoverableGroups: 0 },
    });
    expect(report.ok).toBe(false);
    expect(new Set(report.violations.map((v) => v.code))).toEqual(
      new Set(["word-ceiling", "action-ceiling", "long-option-exposure", "generated-content-recovery"]),
    );
  });
});

describe("setupSurfaceDescriptorSchema", () => {
  it("parses a well-formed descriptor", () => {
    const parsed = setupSurfaceDescriptorSchema.safeParse(baseDescriptor());
    expect(parsed.success).toBe(true);
  });
});
