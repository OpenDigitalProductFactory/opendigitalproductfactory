import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  buildKernelQdrantPoints,
  deriveSlug,
  extractPrinciplePayload,
  extractWikilinks,
  parseFrontmatter,
  PRINCIPLE_ONLY_FRONTMATTER_KEYS,
  type SeedablePage,
  type WikiPageFrontmatter,
} from "./seed-wiki-kernel";
import { isPrincipleDimension, PRINCIPLE_COST_DIMENSIONS } from "./wiki-taxonomy";

describe("seed-wiki-kernel: parseFrontmatter", () => {
  it("parses scalar fields", () => {
    const raw = `---
title: Digital Product
pageKind: entity
status: published
---

A digital product is...`;
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.title).toBe("Digital Product");
    expect(frontmatter.pageKind).toBe("entity");
    expect(frontmatter.status).toBe("published");
    expect(body).toBe("A digital product is...");
  });

  it("parses block-style lists", () => {
    const raw = `---
title: Stance on portfolio anchoring
pageKind: stance
sources:
  - papers/it4it-overview
  - articles/portfolio-as-anchor
---

Body content.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.sources).toEqual([
      "papers/it4it-overview",
      "articles/portfolio-as-anchor",
    ]);
  });

  it("parses inline arrays", () => {
    const raw = `---
title: T
pageKind: entity
sources: [a, b, c]
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.sources).toEqual(["a", "b", "c"]);
  });

  it("strips surrounding quotes from scalars", () => {
    const raw = `---
title: "Quoted Title"
pageKind: 'stance'
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.title).toBe("Quoted Title");
    expect(frontmatter.pageKind).toBe("stance");
  });

  it("normalises CRLF line endings", () => {
    const raw = "---\r\ntitle: T\r\npageKind: entity\r\n---\r\nBody.\r\n";
    const { frontmatter, body } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.title).toBe("T");
    expect(body).toBe("Body.");
  });

  it("throws on missing frontmatter delimiters", () => {
    expect(() => parseFrontmatter("no frontmatter here")).toThrow(/frontmatter delimiters/);
  });

  it("parses inline JSON objects (used for principleDimensionVector)", () => {
    const raw = `---
title: T
pageKind: principle
principleDimensionVector: {"long_term_maintainability": 1.0, "schema_grounding": 0.8, "speed_to_value": -0.4}
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principleDimensionVector).toEqual({
      long_term_maintainability: 1.0,
      schema_grounding: 0.8,
      speed_to_value: -0.4,
    });
  });

  it("coerces true/false scalars to booleans", () => {
    const raw = `---
title: T
pageKind: principle
principlePublic: true
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principlePublic).toBe(true);
  });

  it("coerces numeric scalars to numbers", () => {
    const raw = `---
title: T
pageKind: principle
principleWeight: 0.85
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principleWeight).toBe(0.85);
  });

  it("keeps quoted booleans/numbers as strings (escape hatch for values that look numeric)", () => {
    const raw = `---
title: T
pageKind: principle
principleWeightRationale: "0.8"
---

Body.`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principleWeightRationale).toBe("0.8");
  });
});

describe("seed-wiki-kernel: extractPrinciplePayload", () => {
  it("returns the principle subset of frontmatter for a principle page", () => {
    const payload = extractPrinciplePayload({
      title: "Architecture Over Shortcuts",
      pageKind: "principle",
      principleTier: "commandment",
      principleDirection:
        "Prefer long-term maintainability over short-term speed.",
      principleDimensionVector: {
        long_term_maintainability: 1.0,
        schema_grounding: 0.8,
      },
      principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
      principlePublic: true,
      principlePublicRationale:
        "Adopters need to understand DPF's architecture posture.",
    });

    expect(payload).toEqual({
      principleTier: "commandment",
      principleDirection:
        "Prefer long-term maintainability over short-term speed.",
      principleDimensionVector: {
        long_term_maintainability: 1.0,
        schema_grounding: 0.8,
      },
      principleDimensions: ["long_term_maintainability", "schema_grounding"],
      principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
      principlePublic: true,
      principlePublicRationale:
        "Adopters need to understand DPF's architecture posture.",
    });
  });

  it("derives principleDimensions from vector keys when not explicit", () => {
    const payload = extractPrinciplePayload({
      title: "T",
      pageKind: "principle",
      principleTier: "core",
      principleDimensionVector: {
        capacity_utilization: 1.0,
        governance_compliance: 0.7,
      },
      principleAppliesTo: ["in_platform_coworker"],
    });
    expect(payload.principleDimensions).toEqual([
      "capacity_utilization",
      "governance_compliance",
    ]);
  });

  it("preserves explicit principleDimensions (even when sparser than vector keys)", () => {
    const payload = extractPrinciplePayload({
      title: "T",
      pageKind: "principle",
      principleTier: "core",
      principleDimensions: ["capacity_utilization"],
      principleDimensionVector: {
        capacity_utilization: 1.0,
        governance_compliance: 0.7,
      },
      principleAppliesTo: ["in_platform_coworker"],
    });
    expect(payload.principleDimensions).toEqual(["capacity_utilization"]);
  });

  it("throws with a clear message when the vector references an unknown dimension", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "commandment",
        principleDimensionVector: {
          fictional_axis: 1.0,
          long_term_maintainability: 0.5,
        },
        principleAppliesTo: ["in_platform_coworker"],
      }),
    ).toThrow(/fictional_axis/);
  });

  it("throws when an explicit dimension is outside the registry", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "core",
        principleDimensions: ["long_term_maintainability", "totally_made_up"],
        principleAppliesTo: ["in_platform_coworker"],
      }),
    ).toThrow(/totally_made_up/);
  });

  it("returns an empty payload for non-principle pages", () => {
    const payload = extractPrinciplePayload({
      title: "Edge Node",
      pageKind: "entity",
    });
    expect(payload).toEqual({});
  });

  it("accepts incomplete principle data — validation lives in lint", () => {
    // A draft principle missing direction and vector should still extract;
    // lint detectors (spec section 14) surface the missing fields later.
    const payload = extractPrinciplePayload({
      title: "Draft",
      pageKind: "principle",
      principleTier: "core",
      principleAppliesTo: ["human"],
    });
    expect(payload.principleTier).toBe("core");
    expect(payload.principleAppliesTo).toEqual(["human"]);
    expect(payload.principleDirection).toBeUndefined();
  });

  it("forwards principleConsumerArchetype + principleConsumerContexts for principle pages", () => {
    const payload = extractPrinciplePayload({
      title: "Build Studio: design review required",
      pageKind: "principle",
      principleTier: "core",
      principleDirection: "Build Studio runs require a passing design review.",
      principleAppliesTo: ["in_platform_coworker"],
      principleConsumerArchetype: "route-domain-specific",
      principleConsumerContexts: ["build-studio"],
    });
    expect(payload.principleConsumerArchetype).toBe("route-domain-specific");
    expect(payload.principleConsumerContexts).toEqual(["build-studio"]);
  });

  it("forwards empty principleConsumerContexts for non-route archetypes", () => {
    const payload = extractPrinciplePayload({
      title: "Specialization Over Generalization",
      pageKind: "principle",
      principleTier: "core",
      principleAppliesTo: ["in_platform_coworker"],
      principleConsumerArchetype: "ai-coworker-universal",
      principleConsumerContexts: [],
    });
    expect(payload.principleConsumerArchetype).toBe("ai-coworker-universal");
    expect(payload.principleConsumerContexts).toEqual([]);
  });

  it("throws when principleConsumerArchetype is outside the registry", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "core",
        principleAppliesTo: ["in_platform_coworker"],
        principleConsumerArchetype: "imaginary-archetype",
      }),
    ).toThrow(/imaginary-archetype/);
  });

  it("throws when route-domain-specific has no consumer contexts", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "core",
        principleAppliesTo: ["in_platform_coworker"],
        principleConsumerArchetype: "route-domain-specific",
        principleConsumerContexts: [],
      }),
    ).toThrow(/route-domain-specific.*at least one/i);
  });

  it("throws when principleConsumerContexts contains a malformed slug", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "core",
        principleAppliesTo: ["in_platform_coworker"],
        principleConsumerArchetype: "route-domain-specific",
        principleConsumerContexts: ["Build_Studio"], // uppercase + underscore
      }),
    ).toThrow(/Build_Studio/);
  });

  // Spec §8A.1 coherence matrix — belt-and-suspenders alongside the
  // principle-incoherent-archetype-applies-to lint detector. Seed-time
  // rejection prevents an incoherent page from ever entering the DB.

  it("throws when ai-coworker-universal includes human in principleAppliesTo", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "core",
        principleAppliesTo: ["human", "in_platform_coworker"],
        principleConsumerArchetype: "ai-coworker-universal",
      }),
    ).toThrow(/coherence|incoherent|human/i);
  });

  it("throws when generalist includes human in principleAppliesTo", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "core",
        principleAppliesTo: ["human"],
        principleConsumerArchetype: "generalist",
      }),
    ).toThrow(/coherence|incoherent|human/i);
  });

  it("throws when specialist includes human in principleAppliesTo", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "core",
        principleAppliesTo: ["human"],
        principleConsumerArchetype: "specialist",
      }),
    ).toThrow(/coherence|incoherent|human/i);
  });

  it("throws when universal has only one population in principleAppliesTo", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "T",
        pageKind: "principle",
        principleTier: "commandment",
        principleAppliesTo: ["human"],
        principleConsumerArchetype: "universal",
      }),
    ).toThrow(/universal.*at least two|coherence/i);
  });

  it("accepts universal with two or more populations", () => {
    const payload = extractPrinciplePayload({
      title: "T",
      pageKind: "principle",
      principleTier: "commandment",
      principleAppliesTo: ["human", "in_platform_coworker"],
      principleConsumerArchetype: "universal",
    });
    expect(payload.principleConsumerArchetype).toBe("universal");
  });

  it("accepts route-domain-specific paired with human (per spec §8A.1)", () => {
    const payload = extractPrinciplePayload({
      title: "Storefront operator policy",
      pageKind: "principle",
      principleTier: "contextual",
      principleAppliesTo: ["human"],
      principleConsumerArchetype: "route-domain-specific",
      principleConsumerContexts: ["storefront"],
    });
    expect(payload.principleConsumerArchetype).toBe("route-domain-specific");
    expect(payload.principleAppliesTo).toEqual(["human"]);
  });

  it("rejects consumer-archetype keys on non-principle pages", () => {
    // Previously this short-circuited to {}: the archetype was dropped and the
    // author never learned. The kind mismatch must be what surfaces here — not
    // the "route-domain-specific requires a context" coherence check.
    expect(() =>
      extractPrinciplePayload({
        title: "Edge Node",
        pageKind: "entity",
        principleConsumerArchetype: "route-domain-specific" as never,
      }),
    ).toThrow(/principleConsumerArchetype/);
  });

  // ─── Ring-scope axis (spec 2026-05-24-founder-kernel-evolution-discipline) ───

  it("forwards a valid principleRingScope through unchanged", () => {
    const payload = extractPrinciplePayload({
      title: "Ring-scoped principle",
      pageKind: "principle",
      principleTier: "core",
      principleAppliesTo: ["in_platform_coworker"],
      principleConsumerArchetype: "ai-coworker-universal",
      principleRingScope: ["ring-2-workflow", "ring-3-archetype"],
    });
    expect(payload.principleRingScope).toEqual([
      "ring-2-workflow",
      "ring-3-archetype",
    ]);
  });

  it("throws on unknown principleRingScope value (fails closed, not silent)", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "Bogus scope",
        pageKind: "principle",
        principleTier: "core",
        principleAppliesTo: ["in_platform_coworker"],
        principleConsumerArchetype: "ai-coworker-universal",
        principleRingScope: ["ring-1-coworker", "ring-99-bogus"],
      }),
    ).toThrow(/Unknown principleRingScope value "ring-99-bogus"/);
  });

  it("accepts the universal-ring escape hatch as a valid value", () => {
    const payload = extractPrinciplePayload({
      title: "Universal principle",
      pageKind: "principle",
      principleTier: "commandment",
      principleAppliesTo: ["in_platform_coworker", "human"],
      principleConsumerArchetype: "universal",
      principleRingScope: ["universal-ring"],
    });
    expect(payload.principleRingScope).toEqual(["universal-ring"]);
  });

  it("rejects principleRingScope on non-principle pages", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "Edge Node",
        pageKind: "entity",
        principleRingScope: ["ring-1-coworker"] as never,
      }),
    ).toThrow(/principleRingScope/);
  });

  // ─── Principle payload on the wrong pageKind ─────────────────────────────
  // Regression cover for the silent drop found while building BI-D65E044E
  // Phase 1: a decision-bearing vector authored on a `heuristic` page seeded
  // as prose with the entire payload discarded — no vector, so it contributed
  // nothing to structured option scoring and could not move a verdict. The
  // principle lint detectors select on `pageKind === "principle"`, so nothing
  // downstream could catch it either. `make-silent-failures-observable`
  // requires the author to learn at authoring time.

  it("throws when a heuristic page declares a principle dimension vector", () => {
    expect(() =>
      extractPrinciplePayload({
        title: "Prefer 3NF Until Measured",
        pageKind: "heuristic",
        principleDimensionVector: { schema_grounding: 1.0 },
      }),
    ).toThrow(/principleDimensionVector/);
  });

  it("names every declared principle-only key, and the file, in the message", () => {
    expect(() =>
      extractPrinciplePayload(
        {
          title: "Prefer 3NF Until Measured",
          pageKind: "heuristic",
          principleTier: "core",
          principleDirection: "Normalize first.",
          principleDimensionVector: { schema_grounding: 1.0 },
        },
        "docs/professions/data-architect/wiki/prefer-3nf.md",
      ),
    ).toThrow(/principleTier, principleDirection, principleDimensionVector/);

    // The path is what makes this actionable inside a many-hundred-page seed.
    expect(() =>
      extractPrinciplePayload(
        {
          title: "Prefer 3NF Until Measured",
          pageKind: "heuristic",
          principleDimensionVector: { schema_grounding: 1.0 },
        },
        "docs/professions/data-architect/wiki/prefer-3nf.md",
      ),
    ).toThrow(/prefer-3nf\.md/);
  });

  it("rejects principle payload on every non-principle kind", () => {
    for (const kind of [
      "heuristic",
      "stance",
      "entity",
      "summary",
      "decision",
      "runbook",
      "index",
    ] as const) {
      expect(() =>
        extractPrinciplePayload({
          title: "T",
          pageKind: kind,
          principleDimensionVector: { schema_grounding: 1.0 },
        }),
      ).toThrow(/pageKind: principle ONLY/);
    }
  });

  it("fires on real authored markdown, not just object literals", () => {
    // End-to-end from the raw file shape an author actually writes: the
    // reported case was a profession-corpus page authored exactly like this.
    const raw = `---
title: Prefer 3NF Until Measured
pageKind: heuristic
principleDimensionVector: {"schema_grounding": 1.0}
principleDirection: Normalize first; denormalize on measured read pressure.
---

Prefer 3NF until a measured read-path needs denormalization.`;

    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
    expect(frontmatter.principleDimensionVector).toEqual({
      schema_grounding: 1.0,
    });

    expect(() =>
      extractPrinciplePayload(frontmatter, "docs/professions/x/wiki/y.md"),
    ).toThrow(/principleDirection, principleDimensionVector|principleDimensionVector/);
  });

  it("still returns {} for a non-principle page that declares no payload", () => {
    // The guard must not turn every ordinary corpus page into a seed failure.
    expect(
      extractPrinciplePayload({ title: "Edge Node", pageKind: "heuristic" }),
    ).toEqual({});
  });

  it("keeps the guard key list in sync with the payload builder", () => {
    // Every key the builder forwards must also be a key the guard rejects on
    // the wrong kind. If the two drift, a newly added principle field silently
    // escapes the check — reintroducing exactly this bug for that field.
    const full: WikiPageFrontmatter = {
      title: "T",
      pageKind: "principle",
      principleTier: "core",
      principleDirection: "D",
      principleWeight: 0.5,
      principleWeightRationale: "R",
      principleDimensionVector: { schema_grounding: 1.0 },
      principleDimensions: ["schema_grounding"],
      principleAppliesTo: ["human", "in_platform_coworker"],
      principleRingScope: ["ring-1-coworker"],
      principleConsumerArchetype: "universal",
      principleConsumerContexts: ["data-model"],
      principlePublic: true,
      principlePublicRationale: "PR",
    };

    const guarded = new Set<string>(PRINCIPLE_ONLY_FRONTMATTER_KEYS);
    for (const key of Object.keys(extractPrinciplePayload(full))) {
      expect(guarded.has(key)).toBe(true);
    }
  });
});

describe("founder-kernel principle frontmatter", () => {
  it("assigns a consumer archetype to every authored principle page", () => {
    const principleDir = resolve(
      __dirname,
      "../../../docs/founder-kernel/wiki/principles",
    );
    const missing: string[] = [];

    for (const fileName of readdirSync(principleDir)
      .filter((file) => file.endsWith(".md"))
      .sort()) {
      const raw = readFileSync(resolve(principleDir, fileName), "utf8");
      const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
      if (frontmatter.pageKind !== "principle") continue;

      if (!frontmatter.principleConsumerArchetype) {
        missing.push(`${fileName}: missing principleConsumerArchetype`);
        continue;
      }
      expect(() => extractPrinciplePayload(frontmatter)).not.toThrow();
    }

    expect(missing).toEqual([]);
  });

  it("no authored page declares principle payload on a non-principle kind", () => {
    // The seeder guard only fires when the seed actually runs (which needs a
    // DB). This sweep is the cheap CI-time equivalent, so an author learns at
    // PR time instead of at deploy time. Covers both corpora: the founder
    // kernel and every profession corpus under docs/professions/*/wiki/.
    const repoRoot = resolve(__dirname, "../../..");

    const walk = (dir: string): string[] => {
      if (!existsSync(dir)) return [];
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (entry.endsWith(".md") && !entry.startsWith("README"))
          out.push(full);
      }
      return out;
    };

    const files = [
      ...walk(resolve(repoRoot, "docs/founder-kernel/wiki")),
      ...walk(resolve(repoRoot, "docs/professions")),
    ];
    // Guard the guard: if the corpus paths ever move, this test must fail
    // loudly rather than silently sweep zero files and report success.
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(
        readFileSync(file, "utf8"),
      );
      if (frontmatter.pageKind === "principle") continue;

      const declared = PRINCIPLE_ONLY_FRONTMATTER_KEYS.filter(
        (key) => frontmatter[key] !== undefined,
      );
      if (declared.length > 0) {
        offenders.push(
          `${file.slice(repoRoot.length + 1).replace(/\\/g, "/")} ` +
            `[pageKind: ${frontmatter.pageKind}] declares ${declared.join(", ")}`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("founder-kernel principle: remove-avoidable-failure-opportunities", () => {
  // Spec: docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md §8.
  // Guards that the WWMD "avoid opportunities to fail" principle seeds with a
  // structurally valid, registry-backed dimensionVector so principle_decide
  // scores it via STRUCTURED alignment (not semantic fallback). The proposed
  // tier/vector are flagged for operator calibration in the PR, so this test
  // pins structural intent (valid keys + the two researched signs), NOT exact
  // magnitudes — recalibrating a weight must not break the build.
  const principlePath = resolve(
    __dirname,
    "../../../docs/founder-kernel/wiki/principles/remove-avoidable-failure-opportunities.md",
  );

  it("seeds as a core principle with a valid, registry-backed dimensionVector", () => {
    const raw = readFileSync(principlePath, "utf8");
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);

    expect(frontmatter.pageKind).toBe("principle");
    expect(frontmatter.principleTier).toBe("core");

    // extractPrinciplePayload throws on any unknown dimension key, so a clean
    // extraction is itself the "valid vector" guarantee — assert it explicitly.
    expect(() => extractPrinciplePayload(frontmatter)).not.toThrow();
    const payload = extractPrinciplePayload(frontmatter);

    const vector = payload.principleDimensionVector ?? {};
    const keys = Object.keys(vector);
    expect(keys.length).toBeGreaterThan(0);
    // Every axis must exist in the closed PRINCIPLE_DIMENSIONS registry, else
    // structured scoring could never key on it (and seeding would have thrown).
    for (const key of keys) {
      expect(isPrincipleDimension(key)).toBe(true);
    }

    // Semantic load-bearing signs (researched against option-scoring.ts):
    // option feature scores are non-negative, so a NEGATIVE weight means
    // "an option that adds this axis aligns AGAINST the principle".
    //   - long_term_maintainability: the defining (positive, dominant) axis.
    //   - human_cognitive_load: negative — the principle removes upkeep burden.
    expect(vector["long_term_maintainability"]).toBeGreaterThan(0);
    expect(vector["human_cognitive_load"]).toBeLessThan(0);

    // principleDimensions is derived from the vector keys 1:1 when omitted.
    expect((payload.principleDimensions ?? []).slice().sort()).toEqual(
      keys.slice().sort(),
    );

    // Coherent consumer scoping: an agent-class archetype that must NOT pair
    // with `human` in principleAppliesTo (enforced by the seed coherence matrix).
    expect(frontmatter.principleConsumerArchetype).toBe("ai-coworker-universal");
  });
});

describe("founder-kernel principle dimension-vector sign convention", () => {
  // Cost axes (blast_radius, human_cognitive_load, vendor_lock_in) must carry
  // NEGATIVE weights: a principle reduces a cost by pulling AGAINST that axis
  // (AUTHORING.md §8A.3). Because option features are non-negative, a POSITIVE
  // weight makes principle_decide reward the cost the principle exists to
  // prevent (e.g. never-wipe-db with blast_radius: 1.0 once scored "wipe the
  // db" as its top-aligned option). This guard removes that failure
  // opportunity structurally.
  // Audit: docs/superpowers/audits/2026-06-14-principle-dimension-sign-audit.md
  it("never assigns a positive weight to a cost dimension", () => {
    const principleDir = resolve(
      __dirname,
      "../../../docs/founder-kernel/wiki/principles",
    );
    const offenders: string[] = [];

    for (const fileName of readdirSync(principleDir)
      .filter((file) => file.endsWith(".md"))
      .sort()) {
      const raw = readFileSync(resolve(principleDir, fileName), "utf8");
      const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
      const vector = frontmatter.principleDimensionVector;
      if (!vector) continue;
      for (const dim of PRINCIPLE_COST_DIMENSIONS) {
        const weight = vector[dim];
        if (typeof weight === "number" && weight > 0) {
          offenders.push(
            `${fileName}: ${dim} = ${weight} (cost axis must be <= 0; ` +
              `a positive weight rewards the cost the principle opposes)`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("seed-wiki-kernel: extractWikilinks", () => {
  it("extracts simple wikilinks", () => {
    const body = "See [[entities/digital-product]] for the formal definition.";
    expect(extractWikilinks(body)).toEqual(["entities/digital-product"]);
  });

  it("dedupes repeated links", () => {
    const body = "[[a]] then [[a]] again, also [[b]] and [[a]] once more.";
    expect(extractWikilinks(body).sort()).toEqual(["a", "b"]);
  });

  it("handles multiple distinct links", () => {
    const body = "[[entities/a]] [[stances/b]] [[heuristics/c]]";
    expect(extractWikilinks(body).sort()).toEqual([
      "entities/a",
      "heuristics/c",
      "stances/b",
    ]);
  });

  it("ignores malformed brackets", () => {
    const body = "[ not a link ] [[ also not a link with spaces ]] [missing-closing";
    expect(extractWikilinks(body)).toEqual([]);
  });

  it("returns empty when no links present", () => {
    expect(extractWikilinks("Plain prose with no brackets.")).toEqual([]);
  });
});

describe("seed-wiki-kernel: deriveSlug", () => {
  it("strips base dir and .md extension", () => {
    const base = "/repo/docs/founder-kernel/wiki";
    const path = "/repo/docs/founder-kernel/wiki/entities/digital-product.md";
    expect(deriveSlug(path, base)).toBe("entities/digital-product");
  });

  it("returns absolute path unchanged when not under base", () => {
    const base = "/elsewhere";
    const path = "/repo/file.md";
    expect(deriveSlug(path, base)).toBe("/repo/file");
  });

  it("handles flat files at the base", () => {
    const base = "/repo/wiki";
    const path = "/repo/wiki/index.md";
    expect(deriveSlug(path, base)).toBe("index");
  });
});

describe("seed-wiki-kernel: buildKernelQdrantPoints", () => {
  const now = new Date("2026-05-10T00:00:00Z");

  const pages: SeedablePage[] = [
    {
      id: "wp_kernel_1",
      slug: "entities/digital-product",
      title: "Digital Product",
      body: "A digital product is...",
      pageKind: "entity",
      status: "published",
    },
    {
      id: "wp_kernel_2",
      slug: "stances/portfolio-as-anchor",
      title: "Portfolio as the Anchor",
      body: "The portfolio is the unit of...",
      pageKind: "stance",
      status: "published",
    },
  ];

  it("builds a point per sidecar record that matches a page", () => {
    const points = buildKernelQdrantPoints(
      pages,
      [
        { slug: "entities/digital-product", vector: [0.1, 0.2, 0.3], model: "ai/nomic-embed-text-v1.5" },
        { slug: "stances/portfolio-as-anchor", vector: [0.4, 0.5, 0.6], model: "ai/nomic-embed-text-v1.5" },
      ],
      "0.1.0",
      now,
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      id: "wiki-page-wp_kernel_1",
      vector: [0.1, 0.2, 0.3],
      payload: {
        entityType: "wiki-page",
        entityId: "wp_kernel_1",
        slug: "entities/digital-product",
        title: "Digital Product",
        pageKind: "entity",
        status: "published",
        isKernel: true,
        organizationId: null,
        kernelVersion: "0.1.0",
        kernelPageId: null,
        timestamp: "2026-05-10T00:00:00.000Z",
      },
    });
  });

  it("skips sidecar records with no matching page", () => {
    const points = buildKernelQdrantPoints(
      pages,
      [
        { slug: "entities/digital-product", vector: [0.1], model: "m" },
        { slug: "entities/orphan", vector: [0.2], model: "m" },
      ],
      "0.1.0",
      now,
    );
    expect(points).toHaveLength(1);
    expect(points[0].payload.entityId).toBe("wp_kernel_1");
  });

  it("returns empty array for empty sidecar", () => {
    expect(buildKernelQdrantPoints(pages, [], "0.1.0", now)).toEqual([]);
  });

  it("truncates contentPreview to 500 chars", () => {
    const longBody = "x".repeat(2000);
    const longPages: SeedablePage[] = [
      { id: "wp_long", slug: "entities/long", title: "L", body: longBody, pageKind: "entity", status: "published" },
    ];
    const points = buildKernelQdrantPoints(
      longPages,
      [{ slug: "entities/long", vector: [0], model: "m" }],
      "0.1.0",
      now,
    );
    expect((points[0].payload.contentPreview as string).length).toBe(500);
  });

  it("writes principle payload fields for principle pages and omits them for others (BI-30AA6B76)", () => {
    const mixed: SeedablePage[] = [
      {
        id: "wp_principle_1",
        slug: "principles/architecture-over-shortcuts",
        title: "Architecture Over Shortcuts",
        body: "Prefer the architecturally sound solution...",
        pageKind: "principle",
        status: "published",
        principleTier: "commandment",
        principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
        principleRingScope: ["universal-ring"],
        principleDimensions: ["long_term_maintainability", "blast_radius"],
        principlePublic: true,
      },
      {
        id: "wp_entity_1",
        slug: "entities/digital-product",
        title: "Digital Product",
        body: "A digital product is...",
        pageKind: "entity",
        status: "published",
      },
    ];
    const points = buildKernelQdrantPoints(
      mixed,
      [
        { slug: "principles/architecture-over-shortcuts", vector: [0.1], model: "m" },
        { slug: "entities/digital-product", vector: [0.2], model: "m" },
      ],
      "0.2.1",
      now,
    );
    // Principle page carries the filter axes principle_decide / wiki_query use.
    expect(points[0].payload).toMatchObject({
      pageKind: "principle",
      principleTier: "commandment",
      principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
      principleRingScope: ["universal-ring"],
      principleDimensions: ["long_term_maintainability", "blast_radius"],
      principlePublic: true,
    });
    // Non-principle page must NOT carry principle keys (absence is the marker).
    expect(points[1].payload).not.toHaveProperty("principleTier");
    expect(points[1].payload).not.toHaveProperty("principleAppliesTo");
    expect(points[1].payload).not.toHaveProperty("principleRingScope");
  });
});
