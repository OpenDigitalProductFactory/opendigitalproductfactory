import { describe, expect, it, vi } from "vitest";

import {
  normalizeGapTopic,
  gapFingerprint,
  gapPageSlug,
  recordCoverageGap,
  type RecordCoverageGapClient,
} from "./coverage-gap";

describe("normalizeGapTopic", () => {
  it("lowercases, collapses whitespace, and strips trailing punctuation", () => {
    expect(normalizeGapTopic("  What  would   WE do?? ")).toBe("what would we do");
  });
  it("caps length", () => {
    expect(normalizeGapTopic("x".repeat(500)).length).toBeLessThanOrEqual(160);
  });
});

describe("gapFingerprint", () => {
  it("is deterministic and org-scoped", () => {
    const a = gapFingerprint("org_1", "what would we do?");
    expect(a).toBe(gapFingerprint("org_1", "What would we do"));
    expect(a).not.toBe(gapFingerprint("org_2", "what would we do?"));
  });
});

type Row = Record<string, any>;
function makeFakeDb() {
  const pages: Row[] = [];
  const revisions: Row[] = [];
  let seq = 0;
  const db = {
    wikiPage: {
      findFirst: vi.fn(async (args: any) =>
        pages.find((p) => p.organizationId === args.where.organizationId && p.slug === args.where.slug) ?? null,
      ),
      create: vi.fn(async (args: any) => {
        const row = { id: `wp_${++seq}`, ...args.data };
        pages.push(row);
        return row;
      }),
      update: vi.fn(async (args: any) => {
        const p = pages.find((r) => r.id === args.where.id);
        if (p) Object.assign(p, args.data);
        return p;
      }),
    },
    wikiPageRevision: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: any) => {
        revisions.push({ ...args.data });
        return args.data;
      }),
    },
  } as unknown as RecordCoverageGapClient;
  return { db, pages, revisions };
}

const ORG = "org_1";

describe("recordCoverageGap", () => {
  it("records an unanswered WWWD question as a draft, org-scoped stance page", async () => {
    const fake = makeFakeDb();
    const res = await recordCoverageGap({ organizationId: ORG, query: "What would we do about weekend pricing?" }, { db: fake.db });

    expect(res.recorded).toBe(true);
    expect(res.isNew).toBe(true);
    expect(res.slug.startsWith("open-question-")).toBe(true);
    expect(fake.pages).toHaveLength(1);
    expect(fake.pages[0]).toMatchObject({
      organizationId: ORG,
      status: "draft",
      pageKind: "stance",
      isKernel: false,
    });
    expect(fake.pages[0].body).toContain("weekend pricing");
    expect(fake.revisions).toHaveLength(1);
  });

  it("is idempotent — the same question coalesces to one draft (dedup by fingerprint slug)", async () => {
    const fake = makeFakeDb();
    await recordCoverageGap({ organizationId: ORG, query: "What would we do about refunds?" }, { db: fake.db });
    const second = await recordCoverageGap({ organizationId: ORG, query: "what would we do about REFUNDS??" }, { db: fake.db });

    expect(second.isNew).toBe(false);
    expect(fake.pages).toHaveLength(1); // no duplicate
    expect(fake.revisions).toHaveLength(1); // no extra revision on re-detection
  });

  it("is a no-op for a blank query", async () => {
    const fake = makeFakeDb();
    const res = await recordCoverageGap({ organizationId: ORG, query: "   " }, { db: fake.db });
    expect(res.recorded).toBe(false);
    expect(fake.pages).toHaveLength(0);
  });
});
