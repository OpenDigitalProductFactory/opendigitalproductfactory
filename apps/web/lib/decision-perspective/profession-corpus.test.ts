import { describe, expect, it } from "vitest";

import {
  corpusQueryTerms,
  normalizeCorpusTopic,
  pageEligibleForInstall,
  rankCorpusPages,
  resolveProfessionCorpusContext,
  type ProfessionCorpusClient,
} from "./profession-corpus";
import { findProfessionFamily } from "./resolve-profession-profile";

// ─── Fake corpus DB ───────────────────────────────────────────────────────────

type Row = {
  slug: string;
  title: string;
  abstract: string | null;
  body: string;
  /** WSID variant metadata; null → universal/global (the seed default). */
  metadata: unknown;
};

const SOFTWARE_ENGINEER_PAGES: Row[] = [
  {
    slug: "professions/software-engineer/owasp-top-ten",
    title: "OWASP Top Ten Web Application Security Risks",
    abstract: "The ten most critical web application security risks.",
    body: "Injection, broken access control, and cryptographic failures lead the list. Mitigate with validation.",
    metadata: null,
  },
  {
    slug: "professions/software-engineer/semantic-versioning",
    title: "Semantic Versioning",
    abstract: "MAJOR.MINOR.PATCH version increments convey compatibility.",
    body: "Increment MAJOR for breaking changes, MINOR for features, PATCH for fixes.",
    metadata: null,
  },
  {
    slug: "professions/software-engineer/code-review-standard",
    title: "The Standard of Code Review",
    abstract: "Approve once a change improves overall code health.",
    body: "Reviewers approve when the change improves code health; perfection is not required.",
    metadata: null,
  },
];

function fakeCorpusDb(rows: Row[]): ProfessionCorpusClient {
  return {
    wikiPage: {
      findMany: async (args) => {
        const prefix = (args.where.slug as { startsWith: string }).startsWith;
        return rows
          .filter((r) => r.slug.startsWith(prefix))
          .map((r) => ({ ...r, metadata: r.metadata ?? null }));
      },
    },
  };
}

function throwingDb(): ProfessionCorpusClient {
  return {
    wikiPage: {
      findMany: async () => {
        throw new Error("db down");
      },
    },
  };
}

// ─── Tokeniser ────────────────────────────────────────────────────────────────

describe("corpusQueryTerms", () => {
  it("drops stopwords and short tokens, dedupes, lowercases", () => {
    expect(corpusQueryTerms("How should we handle SQL injection injection?")).toEqual([
      "handle",
      "sql",
      "injection",
    ]);
  });

  it("returns empty for a greeting with no content terms", () => {
    expect(corpusQueryTerms("hi there")).toEqual([]);
  });
});

describe("normalizeCorpusTopic", () => {
  it("normalises whitespace, case, and trailing punctuation", () => {
    expect(normalizeCorpusTopic("  How do I prevent   SQL injection??  ")).toBe(
      "how do i prevent sql injection",
    );
  });
});

// ─── Ranking ──────────────────────────────────────────────────────────────────

describe("rankCorpusPages", () => {
  const family = findProfessionFamily("software-engineer")!;

  it("ranks a title/abstract match above a body-only match", () => {
    const ranked = rankCorpusPages(SOFTWARE_ENGINEER_PAGES, "versioning compatibility", family);
    expect(ranked[0]!.slug).toBe("professions/software-engineer/semantic-versioning");
  });

  it("is deterministic for a query that matches nothing (slug asc)", () => {
    const ranked = rankCorpusPages(SOFTWARE_ENGINEER_PAGES, "xyzzy nothing matches", family);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
    expect(ranked.map((r) => r.slug)).toEqual(
      [...SOFTWARE_ENGINEER_PAGES.map((r) => r.slug)].sort((a, b) => a.localeCompare(b)),
    );
  });
});

// ─── Resolver ─────────────────────────────────────────────────────────────────

describe("resolveProfessionCorpusContext", () => {
  it("injects ranked corpus for a mapped coworker", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(SOFTWARE_ENGINEER_PAGES),
      identity: { agentId: "build-software-engineer" },
      query: "How do I prevent SQL injection in a query?",
    });

    expect(ctx.status).toBe("injected");
    expect(ctx.professionKey).toBe("software-engineer");
    expect(ctx.profileId).toBe("wsid-software-engineer");
    expect(ctx.promptBlock).toContain("PROFESSION CORPUS — Software Engineer");
    expect(ctx.promptBlock).toContain("professions/software-engineer/owasp-top-ten");
    expect(ctx.pages[0]!.slug).toBe("professions/software-engineer/owasp-top-ten");
    expect(ctx.tokenCount).toBeGreaterThan(0);
    expect(ctx.compactBlock).toContain("PROFESSION CORPUS — Software Engineer");
    expect(ctx.lowRelevance).toBe(false);
  });

  it("resolves registry agents whose role slug lives in Agent.name", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(SOFTWARE_ENGINEER_PAGES),
      identity: { agentId: "AGT-XYZ-001", name: "build-software-engineer" },
      query: "code review standards",
    });
    expect(ctx.status).toBe("injected");
    expect(ctx.professionKey).toBe("software-engineer");
  });

  it("caps the number of injected pages", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(SOFTWARE_ENGINEER_PAGES),
      identity: { agentId: "software-engineer" },
      query: "security versioning review",
      maxPages: 2,
    });
    expect(ctx.pages).toHaveLength(2);
  });

  it("returns missed-unmapped for an agent in no family", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(SOFTWARE_ENGINEER_PAGES),
      identity: { agentId: "totally-unknown-agent" },
      query: "anything",
    });
    expect(ctx.status).toBe("missed-unmapped");
    expect(ctx.promptBlock).toBeNull();
    expect(ctx.professionKey).toBeNull();
    expect(ctx.missingTopic).toBe("anything");
  });

  it("returns missed-empty-corpus when the family has no published pages", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb([]), // no rows for any prefix
      identity: { agentId: "build-software-engineer" },
      query: "secure coding",
    });
    expect(ctx.status).toBe("missed-empty-corpus");
    expect(ctx.professionKey).toBe("software-engineer");
    expect(ctx.promptBlock).toBeNull();
    expect(ctx.suggestedSource).toContain("Seed corpus");
  });

  it("returns error status (fail-open) when the corpus read throws", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: throwingDb(),
      identity: { agentId: "build-software-engineer" },
      query: "secure coding",
    });
    expect(ctx.status).toBe("error");
    expect(ctx.promptBlock).toBeNull();
  });

  it("flags low-relevance when a substantive query overlaps no corpus page", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(SOFTWARE_ENGINEER_PAGES),
      identity: { agentId: "build-software-engineer" },
      query: "kubernetes helm chart rollout",
    });
    expect(ctx.status).toBe("injected"); // corpus still injected (always grounded)
    expect(ctx.lowRelevance).toBe(true);
    expect(ctx.suggestedSource).not.toBeNull();
  });
});

// ─── Archetype / jurisdiction variant selection ───────────────────────────────

function meta(archetypes?: string[], jurisdictions?: string[], basis?: string): unknown {
  return {
    ...(archetypes ? { professionArchetype: archetypes } : {}),
    ...(jurisdictions ? { professionJurisdiction: jurisdictions } : {}),
    ...(basis ? { professionJurisdictionBasis: basis } : {}),
  };
}

describe("pageEligibleForInstall", () => {
  it("serves universal/global pages to any install", () => {
    const axes = { archetypes: ["universal"], jurisdictions: ["global"], basis: "global" };
    expect(pageEligibleForInstall(axes, {})).toBe(true);
    expect(pageEligibleForInstall(axes, { archetype: "retail-goods" })).toBe(true);
  });

  it("serves an archetype-specific page ONLY to the matching install", () => {
    const axes = { archetypes: ["automotive-services"], jurisdictions: ["global"], basis: "global" };
    expect(pageEligibleForInstall(axes, { archetype: "automotive-services" })).toBe(true);
    expect(pageEligibleForInstall(axes, { archetype: "retail-goods" })).toBe(false);
    expect(pageEligibleForInstall(axes, {})).toBe(false); // generic install never sees it
  });

  it("a global-basis page (e.g. PCI-DSS) always applies regardless of region", () => {
    const pci = { archetypes: ["universal"], jurisdictions: ["global"], basis: "global" };
    expect(pageEligibleForInstall(pci, { regional: { sellsTo: ["us"] } })).toBe(true);
  });

  it("matches a selling-basis page against sellsTo — a US biz selling into the EU still gets EU rules", () => {
    const euConsent = { archetypes: ["universal"], jurisdictions: ["eu"], basis: "selling" };
    // Operates only in the US, but SELLS into the EU → gets EU marketing-consent doctrine.
    expect(
      pageEligibleForInstall(euConsent, { regional: { operatesIn: ["us"], sellsTo: ["us", "eu"] } }),
    ).toBe(true);
    // Sells only to the US → shielded from EU consent rules.
    expect(pageEligibleForInstall(euConsent, { regional: { operatesIn: ["us"], sellsTo: ["us"] } })).toBe(false);
    // sellsTo undeclared → not filtered (no regression).
    expect(pageEligibleForInstall(euConsent, { regional: {} })).toBe(true);
  });

  it("matches an employing-basis page against employsIn (where employees do the work)", () => {
    const euEmployment = { archetypes: ["universal"], jurisdictions: ["eu"], basis: "employing" };
    expect(pageEligibleForInstall(euEmployment, { regional: { employsIn: ["eu"] } })).toBe(true);
    // Sells to the EU but employs only in the US → EU employment law does NOT apply.
    expect(
      pageEligibleForInstall(euEmployment, { regional: { sellsTo: ["eu"], employsIn: ["us"] } }),
    ).toBe(false);
  });
});

describe("resolveProfessionCorpusContext — variant selection", () => {
  const PAGES: Row[] = [
    {
      slug: "professions/operations/incident-severity",
      title: "Incident severity classification",
      abstract: "Classify incidents by impact.",
      body: "SEV1/SEV2/SEV3 by customer impact and scope.",
      metadata: meta(), // universal/global
    },
    {
      slug: "professions/operations/automotive-adas-recalibration",
      title: "ADAS recalibration after auto-glass replacement",
      abstract: "Windshield work can require ADAS camera recalibration.",
      body: "After glass replacement, recalibrate ADAS per OEM spec; document compliance.",
      metadata: meta(["automotive-services"]),
    },
  ];

  it("excludes another archetype's craft from a non-matching install", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(PAGES),
      identity: { agentId: "operate-orchestrator" },
      query: "how do I handle this incident",
      installContext: { archetype: "retail-goods" },
    });
    expect(ctx.status).toBe("injected");
    expect(ctx.pages.map((p) => p.slug)).not.toContain(
      "professions/operations/automotive-adas-recalibration",
    );
  });

  it("includes AND boosts the archetype-specific page for a matching install", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(PAGES),
      identity: { agentId: "operate-orchestrator" },
      query: "recalibration after glass replacement",
      installContext: { archetype: "automotive-services" },
    });
    expect(ctx.status).toBe("injected");
    expect(ctx.pages[0]!.slug).toBe("professions/operations/automotive-adas-recalibration");
  });

  it("a generic install (no context) sees only the universal page", async () => {
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(PAGES),
      identity: { agentId: "operate-orchestrator" },
      query: "incident severity",
    });
    expect(ctx.pages.map((p) => p.slug)).toEqual(["professions/operations/incident-severity"]);
  });

  it("fails closed instead of injecting another archetype's craft when no page is applicable", async () => {
    const foreignOnly: Row[] = [
      {
        slug: "professions/operations/automotive-adas-recalibration",
        title: "ADAS recalibration after auto-glass replacement",
        abstract: "Windshield work can require ADAS camera recalibration.",
        body: "After glass replacement, recalibrate ADAS per OEM specification.",
        metadata: meta(["automotive-services"]),
      },
    ];
    const ctx = await resolveProfessionCorpusContext({
      db: fakeCorpusDb(foreignOnly),
      identity: { agentId: "operate-orchestrator" },
      query: "plan pasture rotation",
      installContext: { archetype: "agriculture-ranching" },
    });

    expect(ctx.status).toBe("missed-empty-applicable-corpus");
    expect(ctx.pages).toEqual([]);
    expect(ctx.promptBlock).toBeNull();
  });
});
