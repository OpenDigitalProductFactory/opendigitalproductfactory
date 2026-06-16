import { describe, expect, it } from "vitest";

import {
  corpusQueryTerms,
  normalizeCorpusTopic,
  rankCorpusPages,
  resolveProfessionCorpusContext,
  type ProfessionCorpusClient,
} from "./profession-corpus";
import { findProfessionFamily } from "./resolve-profession-profile";

// ─── Fake corpus DB ───────────────────────────────────────────────────────────

type Row = { slug: string; title: string; abstract: string | null; body: string };

const SOFTWARE_ENGINEER_PAGES: Row[] = [
  {
    slug: "professions/software-engineer/owasp-top-ten",
    title: "OWASP Top Ten Web Application Security Risks",
    abstract: "The ten most critical web application security risks.",
    body: "Injection, broken access control, and cryptographic failures lead the list. Mitigate with validation.",
  },
  {
    slug: "professions/software-engineer/semantic-versioning",
    title: "Semantic Versioning",
    abstract: "MAJOR.MINOR.PATCH version increments convey compatibility.",
    body: "Increment MAJOR for breaking changes, MINOR for features, PATCH for fixes.",
  },
  {
    slug: "professions/software-engineer/code-review-standard",
    title: "The Standard of Code Review",
    abstract: "Approve once a change improves overall code health.",
    body: "Reviewers approve when the change improves code health; perfection is not required.",
  },
];

function fakeCorpusDb(rows: Row[]): ProfessionCorpusClient {
  return {
    wikiPage: {
      findMany: async (args) => {
        const prefix = (args.where.slug as { startsWith: string }).startsWith;
        return rows.filter((r) => r.slug.startsWith(prefix));
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
