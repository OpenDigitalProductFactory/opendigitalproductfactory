import { describe, expect, it } from "vitest";

import {
  assessArchetypeFit,
  isImportedTestArtifact,
  isPublishBlockedByFit,
  worstFitSeverity,
} from "./archetype-fit";

describe("assessArchetypeFit", () => {
  it("blocks software-platform / DPF artifacts for a restaurant", () => {
    const result = assessArchetypeFit({
      text: "Our Build Studio helps technical founders ship software with an AI workflow.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("block");
    expect(result.blocked).toBe(true);
    expect(isPublishBlockedByFit(result)).toBe(true);
    expect(isImportedTestArtifact(result)).toBe(true);
    expect(result.findings.some((f) => f.kind === "platform-leak" && /Build Studio/i.test(f.term))).toBe(
      true,
    );
  });

  it("passes clean food-hospitality copy for a restaurant", () => {
    const result = assessArchetypeFit({
      text: "Reserve a table for our seasonal tasting menu and fill quiet midweek covers. Read our reviews.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("ok");
    expect(result.blocked).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it("warns when a restaurant draft uses another archetype's vocabulary", () => {
    const result = assessArchetypeFit({
      text: "Open an account today and check our APY — plus book your annual health screening.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("warn");
    expect(result.blocked).toBe(false);
    expect(result.findings.every((f) => f.kind === "off-archetype")).toBe(true);
    expect(result.findings.map((f) => f.looksLikeCategory)).toContain("banking-financial-services");
  });

  it("does not warn on the active archetype's own vocabulary", () => {
    // "reservation" and "menu" are food-hospitality signatures, so a restaurant
    // must not be warned about its own words.
    const result = assessArchetypeFit({
      text: "Confirm your reservation and view the new menu.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("ok");
  });

  it("still blocks platform leaks regardless of active category", () => {
    const result = assessArchetypeFit({
      text: "Our SaaS software platform is built on Prisma.",
      category: "trades-maintenance",
    });
    expect(result.blocked).toBe(true);
  });

  it("block outranks warn when both are present", () => {
    const result = assessArchetypeFit({
      text: "Build Studio for technical founders — also, book your annual screening.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("block");
  });

  it("treats empty content as ok", () => {
    expect(assessArchetypeFit({ text: "", category: "food-hospitality" }).severity).toBe("ok");
    expect(assessArchetypeFit({ text: null, category: null }).severity).toBe("ok");
  });

  it("computes the worst severity across assessments", () => {
    const ok = assessArchetypeFit({ text: "Reserve a table.", category: "food-hospitality" });
    const warn = assessArchetypeFit({ text: "Check our APY.", category: "food-hospitality" });
    const block = assessArchetypeFit({ text: "Build Studio.", category: "food-hospitality" });
    expect(worstFitSeverity([ok, warn])).toBe("warn");
    expect(worstFitSeverity([ok, warn, block])).toBe("block");
    expect(worstFitSeverity([ok])).toBe("ok");
  });
});
