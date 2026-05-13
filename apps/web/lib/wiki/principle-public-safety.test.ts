// Phase 1 Task 1.7 of the principles-as-wiki-kind plan: public-safety
// lint detector for principle pages. Scope is internal-leakage signals,
// NOT personal-name censorship. Founder biographical references like
// "DPF was founded by Mark Bodman" are product-facing per spec section
// 13.4 and must NOT be blocked.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1 Task 1.7)

import { describe, expect, it } from "vitest";
import { detectPrinciplePublicUnsafeMarker } from "./principle-public-safety";
import type { LintPrincipleWikiPage } from "./principle-lint-detectors";

function makePublicPrinciple(
  body: string,
  overrides: Partial<LintPrincipleWikiPage> = {},
): LintPrincipleWikiPage {
  return {
    id: overrides.id ?? "wp_test",
    slug: overrides.slug ?? "principles/test",
    title: overrides.title ?? "Test Principle",
    body,
    pageKind: "principle",
    status: "published",
    isKernel: true,
    kernelVersion: "0.2.0",
    organizationId: null,
    kernelPageId: null,
    derivedFromKernelVersion: null,
    principleTier: "core",
    principleDirection: "Prefer X over Y.",
    principleWeight: null,
    principleWeightRationale: null,
    principleDimensionVector: { long_term_maintainability: 1.0 },
    principleDimensions: ["long_term_maintainability"],
    principleAppliesTo: ["in_platform_coworker"],
    principlePublic: true,
    principlePublicRationale: "Default rationale for tests.",
    lastReviewedAt: null,
    ...overrides,
  };
}

describe("detectPrinciplePublicUnsafeMarker — local user paths", () => {
  it("flags Windows user paths in public principle bodies", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple(
          "## Why\n\nWe noticed this from C:\\Users\\markbodman\\debug.log during an incident.",
        ),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].findingKind).toBe("principle-public-unsafe-marker");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].detail).toMatchObject({ blocksPublish: true });
  });

  it("flags POSIX home paths", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple("Investigated logs at /home/mbodman/project/."),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("flags macOS user paths", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple("Logs at /Users/marc/dpf/runtime."),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });
});

describe("detectPrinciplePublicUnsafeMarker — memory file paths", () => {
  it("flags raw memory feedback file references", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple(
          "## Why\n\nThis comes from feedback_zero_technical_debt.md in our local notes.",
        ),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("flags raw memory project file references", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple(
          "See project_codex_routing_fix.md for the full story.",
        ),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("flags MEMORY.md filename references", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [makePublicPrinciple("Recorded in MEMORY.md.")],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });
});

describe("detectPrinciplePublicUnsafeMarker — secret-shaped tokens", () => {
  it("flags Anthropic-style sk- tokens", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple("Token sk-ant-abc123def456ghi789jklmno was used."),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("flags GitHub personal access tokens", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple("ghp_abcdefghijklmnopqrstuvwxyz0123456789 in env."),
      ],
    });
    expect(findings).toHaveLength(1);
  });

  it("flags DPF PAT tokens", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple("Set dpf_pat_xyz_abc_123_def_456_ghi in CI."),
      ],
    });
    expect(findings).toHaveLength(1);
  });
});

describe("detectPrinciplePublicUnsafeMarker — internal-only instruction phrases", () => {
  it("flags 'Drive 100% means don\\'t ask' phrasing", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple(
          "Per our internal stance, Drive 100% means don't ask between steps.",
        ),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("flags <internal-only> markers", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple("Background: <internal-only>seeded notes</internal-only>."),
      ],
    });
    expect(findings).toHaveLength(1);
  });
});

describe("detectPrinciplePublicUnsafeMarker — names are allowed in narrative", () => {
  it("does NOT flag founder biographical references", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple(
          "## Why\n\nDPF was founded by Mark Bodman around the IT4IT framework.",
        ),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("does NOT flag product references to Claude or Codex", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple(
          "External coding agents like Claude and Codex follow this rule.",
        ),
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrinciplePublicUnsafeMarker — internal principles are exempt", () => {
  it("does not flag internal-only principles regardless of body content", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple(
          "Token sk-ant-abc123def456ghi789jklmno in C:\\Users\\... per feedback_x.md.",
          { principlePublic: false },
        ),
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrinciplePublicUnsafeMarker — multiple violations reported once per page", () => {
  it("emits a single finding per page, listing every marker found", () => {
    const findings = detectPrinciplePublicUnsafeMarker({
      pages: [
        makePublicPrinciple(
          "From C:\\Users\\foo\\bar.txt — and per feedback_x.md, plus Drive 100% means don't ask.",
        ),
      ],
    });
    expect(findings).toHaveLength(1);
    const markers = findings[0].detail.markers as string[];
    expect(markers.length).toBeGreaterThanOrEqual(3);
  });
});
