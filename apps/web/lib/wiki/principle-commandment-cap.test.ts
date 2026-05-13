// Phase 1 Task 1.6 of the principles-as-wiki-kind plan: cross-page
// commandment-cap detector. Spec section 5.1 caps published kernel
// commandments at 10 — the inflation guard for the top tier.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §5.1, §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1 Task 1.6)

import { describe, expect, it } from "vitest";
import { detectPrincipleCommandmentCapExceeded } from "./principle-commandment-cap";
import type { LintPrincipleWikiPage } from "./principle-lint-detectors";

function makeCommandment(
  id: string,
  reviewed: Date | null,
  overrides: Partial<LintPrincipleWikiPage> = {},
): LintPrincipleWikiPage {
  return {
    id,
    slug: `principles/${id}`,
    title: `Commandment ${id}`,
    body: "## Rule\n\n...",
    pageKind: "principle",
    status: "published",
    isKernel: true,
    kernelVersion: "0.2.0",
    organizationId: null,
    kernelPageId: null,
    derivedFromKernelVersion: null,
    principleTier: "commandment",
    principleDirection: "Prefer X over Y.",
    principleWeight: null,
    principleWeightRationale: null,
    principleDimensionVector: { long_term_maintainability: 1.0 },
    principleDimensions: ["long_term_maintainability"],
    principleAppliesTo: ["in_platform_coworker"],
    principlePublic: false,
    principlePublicRationale: null,
    lastReviewedAt: reviewed,
    ...overrides,
  };
}

describe("detectPrincipleCommandmentCapExceeded", () => {
  it("does not flag when there are 10 or fewer published kernel commandments", () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      makeCommandment(`c${i}`, new Date(2026, 4, i + 1)),
    );
    const findings = detectPrincipleCommandmentCapExceeded({ pages });
    expect(findings).toEqual([]);
  });

  it("flags the commandments beyond the 10-cap, ordered newest-first by lastReviewedAt", () => {
    // 12 commandments — reviewed dates Apr 1 through Apr 12. Newest first
    // means c11 (Apr 12), c10 (Apr 11) ... the OLDEST 10 stay under the cap;
    // the 2 newest exceed it.
    const pages = Array.from({ length: 12 }, (_, i) =>
      makeCommandment(`c${i}`, new Date(2026, 3, i + 1)),
    );
    const findings = detectPrincipleCommandmentCapExceeded({ pages });
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.pageId).sort()).toEqual(["c10", "c11"]);
    for (const f of findings) {
      expect(f.findingKind).toBe("principle-commandment-cap-exceeded");
      expect(f.severity).toBe("error");
      expect(f.detail).toMatchObject({ blocksPublish: true, cap: 10 });
    }
  });

  it("ignores draft commandments — only published rows count against the cap", () => {
    const pages = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeCommandment(`pub${i}`, new Date(2026, 4, i + 1)),
      ),
      makeCommandment("draft1", new Date(2026, 4, 20), { status: "draft" }),
      makeCommandment("review1", new Date(2026, 4, 21), { status: "review-needed" }),
    ];
    const findings = detectPrincipleCommandmentCapExceeded({ pages });
    expect(findings).toEqual([]);
  });

  it("ignores org-overlay commandments — only kernel rows count against the cap", () => {
    const kernel = Array.from({ length: 10 }, (_, i) =>
      makeCommandment(`k${i}`, new Date(2026, 4, i + 1)),
    );
    const overlay = makeCommandment("o1", new Date(2026, 4, 20), {
      isKernel: false,
      organizationId: "org_acme",
    });
    const findings = detectPrincipleCommandmentCapExceeded({
      pages: [...kernel, overlay],
    });
    expect(findings).toEqual([]);
  });

  it("ignores non-commandment-tier principles", () => {
    const pages = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeCommandment(`c${i}`, new Date(2026, 4, i + 1)),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        makeCommandment(`core${i}`, new Date(2026, 4, i + 1), {
          principleTier: "core",
          id: `core${i}`,
          slug: `principles/core${i}`,
        }),
      ),
    ];
    const findings = detectPrincipleCommandmentCapExceeded({ pages });
    expect(findings).toEqual([]);
  });

  it("uses kernel row id as a stable tiebreaker when lastReviewedAt is null", () => {
    // 11 commandments, all with null lastReviewedAt. The detector should
    // still produce a deterministic flag on exactly one of them (by id
    // ordering descending — the lexicographically-newest id) so re-runs
    // don't oscillate which commandment is flagged.
    const pages = Array.from({ length: 11 }, (_, i) =>
      makeCommandment(`cmd_${String(i).padStart(2, "0")}`, null),
    );
    const findings = detectPrincipleCommandmentCapExceeded({ pages });
    expect(findings).toHaveLength(1);
    expect(findings[0].pageId).toBe("cmd_10"); // lexicographically largest
  });
});
