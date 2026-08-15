// Phase 1 of the principles-as-wiki-kind plan: per-page lint detectors
// for principle pages. Cross-page detectors (commandment cap, duplicate,
// contradiction) live in their own files and are covered by separate tests.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1)

import { describe, expect, it } from "vitest";
import {
  detectPrincipleMissingTier,
  detectPrincipleMissingAppliesTo,
  detectPrincipleMissingDirection,
  detectPrincipleMissingVector,
  detectPrincipleSparseVector,
  COMMANDMENT_MIN_VECTOR_KEYS,
  CORE_MIN_VECTOR_KEYS,
  detectPrincipleVectorDimensionMismatch,
  detectPrincipleUnknownDimension,
  detectPrincipleTierWeightMismatch,
  detectPrinciplePublicMissingRationale,
  detectPrincipleRuntimeEnforcement,
  detectPrincipleRingScopeUnknown,
  detectPrincipleRingScopeOveruse,
} from "./principle-lint-detectors";
import type { LintPrincipleWikiPage } from "./principle-lint-detectors";

function makePrinciplePage(
  overrides: Partial<LintPrincipleWikiPage>,
): LintPrincipleWikiPage {
  return {
    id: overrides.id ?? "wp_test",
    slug: overrides.slug ?? "principles/test",
    title: overrides.title ?? "Test Principle",
    body: overrides.body ?? "## Rule\n\nA test principle.",
    pageKind: "principle",
    status: overrides.status ?? "published",
    isKernel: overrides.isKernel ?? true,
    kernelVersion: overrides.kernelVersion ?? "0.2.0",
    organizationId: overrides.organizationId ?? null,
    kernelPageId: overrides.kernelPageId ?? null,
    derivedFromKernelVersion: overrides.derivedFromKernelVersion ?? null,
    principleTier: overrides.principleTier ?? null,
    principleDirection: overrides.principleDirection ?? null,
    principleWeight: overrides.principleWeight ?? null,
    principleWeightRationale: overrides.principleWeightRationale ?? null,
    principleDimensionVector: overrides.principleDimensionVector ?? null,
    principleDimensions: overrides.principleDimensions ?? [],
    principleAppliesTo: overrides.principleAppliesTo ?? [],
    principleRingScope: overrides.principleRingScope ?? [],
    principlePublic: overrides.principlePublic ?? false,
    principlePublicRationale: overrides.principlePublicRationale ?? null,
    principleRuntimeEnforcement: overrides.principleRuntimeEnforcement ?? null,
    lastReviewedAt: overrides.lastReviewedAt ?? null,
  };
}

describe("detectPrincipleMissingTier", () => {
  it("flags a principle page with no tier as error / blocks publish", () => {
    const findings = detectPrincipleMissingTier({
      pages: [makePrinciplePage({ id: "wp1", principleTier: null })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].findingKind).toBe("principle-missing-tier");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].pageId).toBe("wp1");
    expect(findings[0].detail).toMatchObject({ blocksPublish: true });
  });

  it("does not flag principle pages with a tier set", () => {
    const findings = detectPrincipleMissingTier({
      pages: [makePrinciplePage({ principleTier: "core" })],
    });
    expect(findings).toEqual([]);
  });

  it("ignores non-principle pages entirely", () => {
    const findings = detectPrincipleMissingTier({
      pages: [{ ...makePrinciplePage({}), pageKind: "entity" }],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrincipleMissingAppliesTo", () => {
  it("flags a principle page with empty applies-to as error / blocks publish", () => {
    const findings = detectPrincipleMissingAppliesTo({
      pages: [makePrinciplePage({ id: "wp1", principleAppliesTo: [] })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].findingKind).toBe("principle-missing-applies-to");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].detail).toMatchObject({ blocksPublish: true });
  });

  it("does not flag pages with at least one applies-to entry", () => {
    const findings = detectPrincipleMissingAppliesTo({
      pages: [
        makePrinciplePage({ principleAppliesTo: ["in_platform_coworker"] }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("ignores non-principle pages entirely", () => {
    const findings = detectPrincipleMissingAppliesTo({
      pages: [{ ...makePrinciplePage({}), pageKind: "stance" }],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrincipleMissingDirection (tier-gated severity)", () => {
  it("flags commandment without direction as error / blocks publish", () => {
    const findings = detectPrincipleMissingDirection({
      pages: [
        makePrinciplePage({
          principleTier: "commandment",
          principleDirection: null,
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].detail).toMatchObject({ blocksPublish: true });
  });

  it("flags core without direction as error / blocks publish", () => {
    const findings = detectPrincipleMissingDirection({
      pages: [
        makePrinciplePage({ principleTier: "core", principleDirection: null }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("flags contextual without direction as warn (does not block)", () => {
    const findings = detectPrincipleMissingDirection({
      pages: [
        makePrinciplePage({
          principleTier: "contextual",
          principleDirection: null,
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].detail).toMatchObject({ blocksPublish: false });
  });

  it("does not flag principles with a direction set", () => {
    const findings = detectPrincipleMissingDirection({
      pages: [
        makePrinciplePage({
          principleTier: "commandment",
          principleDirection: "Prefer X over Y.",
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("ignores principles with no tier (caught by missing-tier instead)", () => {
    const findings = detectPrincipleMissingDirection({
      pages: [
        makePrinciplePage({ principleTier: null, principleDirection: null }),
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrincipleMissingVector", () => {
  it("flags commandment with empty/null vector as error / blocks publish", () => {
    const findingsEmpty = detectPrincipleMissingVector({
      pages: [
        makePrinciplePage({
          principleTier: "commandment",
          principleDimensionVector: {},
        }),
      ],
    });
    expect(findingsEmpty).toHaveLength(1);
    expect(findingsEmpty[0].severity).toBe("error");
    expect(findingsEmpty[0].detail).toMatchObject({ blocksPublish: true });

    const findingsNull = detectPrincipleMissingVector({
      pages: [
        makePrinciplePage({
          principleTier: "commandment",
          principleDimensionVector: null,
        }),
      ],
    });
    expect(findingsNull).toHaveLength(1);
    expect(findingsNull[0].severity).toBe("error");
  });

  it("flags core with empty vector as warn (does not block)", () => {
    const findings = detectPrincipleMissingVector({
      pages: [
        makePrinciplePage({
          principleTier: "core",
          principleDimensionVector: null,
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].detail).toMatchObject({ blocksPublish: false });
  });

  it("does not flag contextual without a vector", () => {
    const findings = detectPrincipleMissingVector({
      pages: [
        makePrinciplePage({
          principleTier: "contextual",
          principleDimensionVector: null,
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("does not flag principles with a non-empty vector", () => {
    const findings = detectPrincipleMissingVector({
      pages: [
        makePrinciplePage({
          principleTier: "commandment",
          principleDimensionVector: { long_term_maintainability: 1.0 },
        }),
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrincipleSparseVector (BI-6006E35D densify floors)", () => {
  it("uses commandment floor ≥4 and core floor ≥3", () => {
    expect(COMMANDMENT_MIN_VECTOR_KEYS).toBe(4);
    expect(CORE_MIN_VECTOR_KEYS).toBe(3);
  });

  it("warns when a commandment has a non-empty vector below the floor", () => {
    const findings = detectPrincipleSparseVector({
      pages: [
        makePrinciplePage({
          principleTier: "commandment",
          principleDimensionVector: {
            long_term_maintainability: 1.0,
            schema_grounding: 0.5,
            blast_radius: -0.3,
          },
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].findingKind).toBe("principle-sparse-vector");
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].detail).toMatchObject({
      blocksPublish: false,
      keyCount: 3,
      minKeys: 4,
    });
  });

  it("does not warn when a commandment meets the floor", () => {
    const findings = detectPrincipleSparseVector({
      pages: [
        makePrinciplePage({
          principleTier: "commandment",
          principleDimensionVector: {
            long_term_maintainability: 1.0,
            schema_grounding: 0.5,
            blast_radius: -0.3,
            evidence_density: 0.4,
          },
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("warns core principles below three keys but not at three", () => {
    const thin = detectPrincipleSparseVector({
      pages: [
        makePrinciplePage({
          principleTier: "core",
          principleDimensionVector: {
            cost_efficiency: 0.7,
            reusability: 0.4,
          },
        }),
      ],
    });
    expect(thin).toHaveLength(1);
    expect(thin[0].detail).toMatchObject({ keyCount: 2, minKeys: 3 });

    const ok = detectPrincipleSparseVector({
      pages: [
        makePrinciplePage({
          principleTier: "core",
          principleDimensionVector: {
            cost_efficiency: 0.7,
            reusability: 0.4,
            evidence_density: 0.5,
          },
        }),
      ],
    });
    expect(ok).toEqual([]);
  });
});

describe("detectPrincipleVectorDimensionMismatch", () => {
  it("flags when vector keys do not match the principleDimensions array as warn", () => {
    const findings = detectPrincipleVectorDimensionMismatch({
      pages: [
        makePrinciplePage({
          principleDimensionVector: {
            long_term_maintainability: 1.0,
            schema_grounding: 0.5,
          },
          principleDimensions: ["long_term_maintainability"], // missing schema_grounding
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].detail).toMatchObject({ blocksPublish: false });
  });

  it("does not flag when keys match exactly (any order)", () => {
    const findings = detectPrincipleVectorDimensionMismatch({
      pages: [
        makePrinciplePage({
          principleDimensionVector: {
            schema_grounding: 0.5,
            long_term_maintainability: 1.0,
          },
          principleDimensions: [
            "long_term_maintainability",
            "schema_grounding",
          ],
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("does not flag when no vector is set (other detectors handle that)", () => {
    const findings = detectPrincipleVectorDimensionMismatch({
      pages: [
        makePrinciplePage({
          principleDimensionVector: null,
          principleDimensions: ["long_term_maintainability"],
        }),
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrincipleUnknownDimension", () => {
  it("flags out-of-registry vector keys as error / blocks publish", () => {
    const findings = detectPrincipleUnknownDimension({
      pages: [
        makePrinciplePage({
          principleDimensionVector: {
            long_term_maintainability: 1.0,
            fictional_axis: 0.5,
          },
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].detail).toMatchObject({ blocksPublish: true });
    expect(findings[0].detail).toMatchObject({
      unknownDimensions: ["fictional_axis"],
    });
  });

  it("flags out-of-registry entries in principleDimensions array as error", () => {
    const findings = detectPrincipleUnknownDimension({
      pages: [
        makePrinciplePage({
          principleDimensions: [
            "long_term_maintainability",
            "totally_made_up",
          ],
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].detail).toMatchObject({
      unknownDimensions: ["totally_made_up"],
    });
  });

  it("does not flag principles whose every key is in the registry", () => {
    const findings = detectPrincipleUnknownDimension({
      pages: [
        makePrinciplePage({
          principleDimensionVector: {
            long_term_maintainability: 1.0,
            schema_grounding: 0.8,
          },
          principleDimensions: [
            "long_term_maintainability",
            "schema_grounding",
          ],
        }),
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrincipleTierWeightMismatch", () => {
  it("flags weight overrides without rationale as warn", () => {
    const findings = detectPrincipleTierWeightMismatch({
      pages: [
        makePrinciplePage({
          principleTier: "core",
          principleWeight: 0.85, // diverges from 0.4 default
          principleWeightRationale: null,
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].detail).toMatchObject({ blocksPublish: false });
  });

  it("does not flag overrides accompanied by a rationale", () => {
    const findings = detectPrincipleTierWeightMismatch({
      pages: [
        makePrinciplePage({
          principleTier: "core",
          principleWeight: 0.85,
          principleWeightRationale:
            "This principle is unusually load-bearing for early-stage portfolios.",
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("does not flag weights that match the tier default", () => {
    const findings = detectPrincipleTierWeightMismatch({
      pages: [
        makePrinciplePage({
          principleTier: "commandment",
          principleWeight: 1.0,
          principleWeightRationale: null,
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("does not flag when no override is set (null weight = use tier default)", () => {
    const findings = detectPrincipleTierWeightMismatch({
      pages: [
        makePrinciplePage({
          principleTier: "core",
          principleWeight: null,
        }),
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrinciplePublicMissingRationale", () => {
  it("flags public principles missing a rationale as warn", () => {
    const findings = detectPrinciplePublicMissingRationale({
      pages: [
        makePrinciplePage({
          principlePublic: true,
          principlePublicRationale: null,
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].detail).toMatchObject({ blocksPublish: false });
  });

  it("does not flag public principles with a rationale", () => {
    const findings = detectPrinciplePublicMissingRationale({
      pages: [
        makePrinciplePage({
          principlePublic: true,
          principlePublicRationale:
            "Adopters benefit from seeing DPF's architecture posture.",
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("does not flag internal principles regardless of rationale field", () => {
    const findings = detectPrinciplePublicMissingRationale({
      pages: [
        makePrinciplePage({
          principlePublic: false,
          principlePublicRationale: null,
        }),
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrincipleRuntimeEnforcement", () => {
  it("returns no findings when the field is absent", () => {
    expect(
      detectPrincipleRuntimeEnforcement({
        pages: [makePrinciplePage({ principleRuntimeEnforcement: null })],
      }),
    ).toEqual([]);
  });

  it("flags invalid modes as error", () => {
    const findings = detectPrincipleRuntimeEnforcement({
      pages: [
        makePrinciplePage({
          principleRuntimeEnforcement: {
            interactiveMode: "bogus" as never,
            autonomousMode: "refuse",
            patterns: [{ kind: "shell", regex: "^x", rationale: "x" }],
          },
        }),
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ findingKind: "runtime-enforcement-invalid-mode" as never }),
    );
  });

  it("flags an empty patterns array as warn (operator should remove the block)", () => {
    const findings = detectPrincipleRuntimeEnforcement({
      pages: [
        makePrinciplePage({
          principleRuntimeEnforcement: {
            interactiveMode: "confirm",
            autonomousMode: "refuse",
            patterns: [],
          },
        }),
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ findingKind: "runtime-enforcement-empty-patterns" as never }),
    );
  });

  it("flags an uncompilable regex as error", () => {
    const findings = detectPrincipleRuntimeEnforcement({
      pages: [
        makePrinciplePage({
          principleRuntimeEnforcement: {
            interactiveMode: "confirm",
            autonomousMode: "refuse",
            patterns: [{ kind: "shell", regex: "[unterminated", rationale: "x" }],
          },
        }),
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ findingKind: "runtime-enforcement-invalid-regex" as never }),
    );
  });

  it("accepts a (?i)-prefixed regex (lifted to RegExp flags by the gate)", () => {
    const findings = detectPrincipleRuntimeEnforcement({
      pages: [
        makePrinciplePage({
          principleRuntimeEnforcement: {
            interactiveMode: "confirm",
            autonomousMode: "refuse",
            patterns: [{ kind: "sql", regex: "(?i)^\s*DROP\s+DATABASE\s+dpf\b", rationale: "Drops prod DB" }],
          },
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("flags missing rationale as warn", () => {
    const findings = detectPrincipleRuntimeEnforcement({
      pages: [
        makePrinciplePage({
          principleRuntimeEnforcement: {
            interactiveMode: "confirm",
            autonomousMode: "refuse",
            patterns: [{ kind: "shell", regex: "^docker", rationale: "  " }],
          },
        }),
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ findingKind: "runtime-enforcement-missing-rationale" as never }),
    );
  });

  it("flags an mcp_tool pattern with empty toolName as error", () => {
    const findings = detectPrincipleRuntimeEnforcement({
      pages: [
        makePrinciplePage({
          principleRuntimeEnforcement: {
            interactiveMode: "confirm",
            autonomousMode: "refuse",
            patterns: [{ kind: "mcp_tool", toolName: "", rationale: "x" }],
          },
        }),
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ findingKind: "runtime-enforcement-invalid-tool-name" as never }),
    );
  });

  it("accepts a well-formed runtime-enforcement block", () => {
    expect(
      detectPrincipleRuntimeEnforcement({
        pages: [
          makePrinciplePage({
            principleRuntimeEnforcement: {
              interactiveMode: "confirm",
              autonomousMode: "refuse",
              patterns: [
                { kind: "shell", regex: "^docker\s+volume\s+rm\b", rationale: "wipes" },
                { kind: "mcp_tool", toolName: "prisma_migrate_reset", rationale: "drops schema" },
              ],
            },
          }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("detectPrincipleRingScopeUnknown", () => {
  it("flags an unknown ring-scope value as error / blocks publish", () => {
    const findings = detectPrincipleRingScopeUnknown({
      pages: [
        makePrinciplePage({
          id: "wp1",
          principleRingScope: ["ring-1-coworker", "ring-99-galaxy"],
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].findingKind).toBe("principle-ring-scope-unknown");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].detail).toMatchObject({
      blocksPublish: true,
      unknownRingScopes: ["ring-99-galaxy"],
    });
  });

  it("does not flag known ring-scope values", () => {
    const findings = detectPrincipleRingScopeUnknown({
      pages: [
        makePrinciplePage({
          principleRingScope: ["ring-2-workflow", "universal-ring"],
        }),
      ],
    });
    expect(findings).toEqual([]);
  });

  it("does not flag empty ring scope (intentional — backfill is incremental)", () => {
    const findings = detectPrincipleRingScopeUnknown({
      pages: [makePrinciplePage({ principleRingScope: [] })],
    });
    expect(findings).toEqual([]);
  });

  it("ignores non-principle pages entirely", () => {
    const findings = detectPrincipleRingScopeUnknown({
      pages: [
        { ...makePrinciplePage({ principleRingScope: ["bogus"] }), pageKind: "entity" },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectPrincipleRingScopeOveruse", () => {
  it("does not fire when universal-ring usage is at or below 30%", () => {
    // 3 of 10 published → exactly 30%, threshold is strict-greater, so OK
    const pages = [
      ...Array.from({ length: 3 }, (_, i) =>
        makePrinciplePage({
          id: `u${i}`,
          status: "published",
          principleRingScope: ["universal-ring"],
        }),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        makePrinciplePage({
          id: `r${i}`,
          status: "published",
          principleRingScope: ["ring-1-coworker"],
        }),
      ),
    ];
    expect(detectPrincipleRingScopeOveruse({ pages })).toEqual([]);
  });

  it("fires warn on every universal-ring published principle when ratio > 30%", () => {
    // 4 of 10 published → 40%, exceeds threshold
    const pages = [
      ...Array.from({ length: 4 }, (_, i) =>
        makePrinciplePage({
          id: `u${i}`,
          status: "published",
          principleRingScope: ["universal-ring"],
        }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        makePrinciplePage({
          id: `r${i}`,
          status: "published",
          principleRingScope: ["ring-1-coworker"],
        }),
      ),
    ];
    const findings = detectPrincipleRingScopeOveruse({ pages });
    expect(findings).toHaveLength(4);
    for (const f of findings) {
      expect(f.findingKind).toBe("principle-ring-scope-overuse");
      expect(f.severity).toBe("warn");
      expect(f.detail).toMatchObject({
        universalCount: 4,
        publishedCount: 10,
        threshold: 0.3,
      });
    }
  });

  it("counts only published principles toward the ratio", () => {
    // 1 draft + 1 published universal-ring + 1 published narrow-ring
    // → 1/2 = 50% of PUBLISHED triggers the warn on the 1 published universal
    const pages = [
      makePrinciplePage({
        id: "draft1",
        status: "draft",
        principleRingScope: ["universal-ring"],
      }),
      makePrinciplePage({
        id: "pub1",
        status: "published",
        principleRingScope: ["universal-ring"],
      }),
      makePrinciplePage({
        id: "pub2",
        status: "published",
        principleRingScope: ["ring-2-workflow"],
      }),
    ];
    const findings = detectPrincipleRingScopeOveruse({ pages });
    expect(findings).toHaveLength(1);
    expect(findings[0].pageId).toBe("pub1");
  });

  it("returns no findings when there are no published principles", () => {
    const findings = detectPrincipleRingScopeOveruse({
      pages: [
        makePrinciplePage({
          status: "draft",
          principleRingScope: ["universal-ring"],
        }),
      ],
    });
    expect(findings).toEqual([]);
  });
});
