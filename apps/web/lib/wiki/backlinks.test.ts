import { describe, expect, it } from "vitest";

import {
  canReadWikiPage,
  loadWikiBacklinks,
  type WikiBacklinksClient,
  type WikiReader,
} from "./backlinks";

// BI-4EAFF7AC. R1: a link never grants access. Every row the panel shows, and
// every count, must come from pages this reader can open.

type Page = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  organizationId: string | null;
  kernelPageId: string | null;
  body: string;
};
type Link = { fromPageId: string; toPageId: string };

const page = (p: Partial<Page> & Pick<Page, "id" | "slug">): Page => ({
  title: p.slug,
  pageKind: "stance",
  status: "published",
  isKernel: false,
  organizationId: null,
  kernelPageId: null,
  body: "",
  ...p,
});

function orgScopeMatches(where: Record<string, unknown> | undefined, p: Page): boolean {
  if (!where) return true;
  if ("organizationId" in where) return p.organizationId === where.organizationId;
  const or = where.OR as Array<{ organizationId: string | null }> | undefined;
  return or ? or.some((c) => c.organizationId === p.organizationId) : true;
}

function fakeDb(pages: Page[], links: Link[]): WikiBacklinksClient {
  const byId = new Map(pages.map((p) => [p.id, p]));
  return {
    wikiPageLink: {
      findMany: async (args: { where: { toPageId: { in: string[] } } }) =>
        links
          .filter((l) => args.where.toPageId.in.includes(l.toPageId))
          .map((l) => ({ toPageId: l.toPageId, fromPage: byId.get(l.fromPageId)! })),
    },
    wikiPage: {
      findMany: async (args: {
        where: { AND: [{ id: { notIn: string[] } }, Record<string, unknown>, { OR: Array<{ body: { contains: string } }> }] };
      }) => {
        const [ids, scope, terms] = args.where.AND;
        return pages.filter(
          (p) =>
            !ids.id.notIn.includes(p.id) &&
            orgScopeMatches(scope, p) &&
            terms.OR.some((t) => p.body.toLowerCase().includes(t.body.contains.toLowerCase())),
        );
      },
    },
  } as unknown as WikiBacklinksClient;
}

const readerA: WikiReader = { organizationId: "org-a", professionFamilies: null, familyKey: null };

const target = page({ id: "k-csdm", slug: "entities/csdm", title: "CSDM", isKernel: true, pageKind: "entity" });

describe("canReadWikiPage", () => {
  it("reads kernel pages and the reader's own organization pages only", () => {
    expect(canReadWikiPage(readerA, target)).toBe(true);
    expect(canReadWikiPage(readerA, page({ id: "a", slug: "s", organizationId: "org-a" }))).toBe(true);
    expect(canReadWikiPage(readerA, page({ id: "b", slug: "s", organizationId: "org-b" }))).toBe(false);
  });

  it("with no reader organization (failed-closed seam) reads no organization page at all", () => {
    const none: WikiReader = { organizationId: null, professionFamilies: null, familyKey: null };
    expect(canReadWikiPage(none, page({ id: "a", slug: "s", organizationId: "org-a" }))).toBe(false);
    expect(canReadWikiPage(none, target)).toBe(true);
  });

  it("applies the profession-family seam when a family set is given", () => {
    const hrOnly: WikiReader = { ...readerA, professionFamilies: new Set(["hr"]) };
    expect(canReadWikiPage(hrOnly, page({ id: "p1", slug: "professions/hr/onboarding" }))).toBe(true);
    expect(canReadWikiPage(hrOnly, page({ id: "p2", slug: "professions/finance/close" }))).toBe(false);
    expect(canReadWikiPage(hrOnly, target)).toBe(true);
  });
});

describe("loadWikiBacklinks — Linked from", () => {
  const ownOrg = page({ id: "a1", slug: "stances/use-csdm", title: "Use CSDM", organizationId: "org-a", body: "We build on [[entities/csdm|the CSDM]] every time." });
  const kernelCiting = page({ id: "k2", slug: "entities/portfolio", title: "Portfolio", isKernel: true, pageKind: "entity", body: "- Describes: `[[entities/csdm]]`." });
  const profession = page({ id: "p1", slug: "professions/data-architect/one-data-model", title: "One data model", body: "Anchor on [[entities/csdm]]." });
  const otherOrg = page({ id: "b1", slug: "stances/secret", title: "Org B secret stance", organizationId: "org-b", body: "[[entities/csdm]]" });
  const pages = [target, ownOrg, kernelCiting, profession, otherOrg];
  const links: Link[] = [
    { fromPageId: "a1", toPageId: "k-csdm" },
    { fromPageId: "k2", toPageId: "k-csdm" },
    { fromPageId: "p1", toPageId: "k-csdm" },
    { fromPageId: "b1", toPageId: "k-csdm" },
  ];

  it("AC-KLB-1: lists exactly the readable inbound pages, each with kind, scope and link context", async () => {
    const result = await loadWikiBacklinks(fakeDb(pages, links), { page: target, reader: readerA });

    const rows = result.linkedFrom.flatMap((g) => g.rows);
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "k2", "p1"]);
    expect(result.linkedFromCount).toBe(3);
    const own = rows.find((r) => r.id === "a1")!;
    expect(own).toMatchObject({ title: "Use CSDM", pageKind: "stance", scope: "organization", href: "/coworker-decisions/stances/use-csdm" });
    expect(own.context).toContain("the CSDM");
    expect(own.context).not.toContain("[[");
  });

  it("AC-KLB-4: another organization's citing page is neither shown nor counted", async () => {
    const result = await loadWikiBacklinks(fakeDb(pages, links), { page: target, reader: readerA });

    expect(JSON.stringify(result)).not.toContain("Org B secret stance");
    expect(result.linkedFromCount).toBe(3);
  });

  it("AC-KLB-4 (family seam): a profession page outside the reader's families is neither shown nor counted", async () => {
    const reader: WikiReader = { ...readerA, professionFamilies: new Set(["hr"]) };
    const result = await loadWikiBacklinks(fakeDb(pages, links), { page: target, reader });

    expect(result.linkedFrom.flatMap((g) => g.rows).map((r) => r.id).sort()).toEqual(["a1", "k2"]);
    expect(result.linkedFromCount).toBe(2);
  });

  it("groups by scope with the reader's own organization first, and the reader's own family before other families", async () => {
    const result = await loadWikiBacklinks(fakeDb(pages, links), {
      page: target,
      reader: { ...readerA, familyKey: "data-architect" },
    });
    expect(result.linkedFrom.map((g) => g.scope)).toEqual(["profession-own", "organization", "platform"]);

    const noFamily = await loadWikiBacklinks(fakeDb(pages, links), { page: target, reader: readerA });
    expect(noFamily.linkedFrom.map((g) => g.scope)).toEqual(["organization", "platform", "profession"]);
  });

  it("AC-KLB-6: with two organizations, each reader sees only their own organization's overlay backlinks", async () => {
    const forA = await loadWikiBacklinks(fakeDb(pages, links), { page: target, reader: readerA });
    const forB = await loadWikiBacklinks(fakeDb(pages, links), {
      page: target,
      reader: { organizationId: "org-b", professionFamilies: null, familyKey: null },
    });
    const ids = (r: typeof forA) => r.linkedFrom.flatMap((g) => g.rows).map((x) => x.id);

    expect(ids(forA)).toContain("a1");
    expect(ids(forA)).not.toContain("b1");
    expect(ids(forB)).toContain("b1");
    expect(ids(forB)).not.toContain("a1");
  });

  it("AC-KLB-3: on an override page, lists links to the override and to the kernel page it overrides, labelled", async () => {
    const override = page({ id: "a-csdm", slug: "entities/csdm", title: "CSDM (ours)", organizationId: "org-a", kernelPageId: "k-csdm", pageKind: "entity" });
    const toOverride = page({ id: "a2", slug: "stances/x", title: "X", organizationId: "org-a", body: "[[entities/csdm]]" });
    const result = await loadWikiBacklinks(
      fakeDb([...pages, override, toOverride], [...links, { fromPageId: "a2", toPageId: "a-csdm" }]),
      { page: override, reader: readerA },
    );
    const rows = result.linkedFrom.flatMap((g) => g.rows);

    expect(rows.find((r) => r.id === "a2")?.via).toBe("this-page");
    expect(rows.find((r) => r.id === "k2")?.via).toBe("kernel-page");
  });

  it("shows a plain empty state signal when nothing links here", async () => {
    const lonely = page({ id: "k9", slug: "entities/lonely", title: "Lonely", isKernel: true });
    const result = await loadWikiBacklinks(fakeDb([lonely], []), { page: lonely, reader: readerA });
    expect(result.linkedFromCount).toBe(0);
    expect(result.linkedFrom).toEqual([]);
    expect(result.unlinkedMentions).toEqual([]);
  });
});

describe("loadWikiBacklinks — Unlinked mentions", () => {
  const linker = page({ id: "a1", slug: "stances/links", title: "Links", organizationId: "org-a", body: "Uses [[entities/csdm]] and says CSDM." });
  const mentioner = page({ id: "a3", slug: "stances/mentions", title: "Mentions", organizationId: "org-a", body: "Our CSDM model matters." });
  const kernelMention = page({ id: "k4", slug: "stances/kernel-mention", title: "Kernel mention", isKernel: true, body: "The CSDM is canonical." });
  const codeOnly = page({ id: "a5", slug: "stances/code", title: "Code", organizationId: "org-a", body: "Run `csdm-sync` and `CSDM`." });
  const partial = page({ id: "a6", slug: "stances/partial", title: "Partial", organizationId: "org-a", body: "CSDMX is something else." });
  const otherOrg = page({ id: "b3", slug: "stances/b", title: "Org B mention", organizationId: "org-b", body: "CSDM too." });
  const pages = [target, linker, mentioner, kernelMention, codeOnly, partial, otherOrg];
  const links: Link[] = [{ fromPageId: "a1", toPageId: "k-csdm" }];

  it("AC-KLB-2: lists readable pages naming the title or slug as a whole word, leaving out pages that already link", async () => {
    const result = await loadWikiBacklinks(fakeDb(pages, links), { page: target, reader: readerA });
    const ids = result.unlinkedMentions.map((m) => m.id).sort();

    expect(ids).toEqual(["a3", "k4"]);
    expect(result.unlinkedMentions.find((m) => m.id === "a3")?.context).toContain("CSDM model");
  });

  it("AC-KLB-5: offers Link it only on organization overlay pages, never on kernel or profession pages", async () => {
    const result = await loadWikiBacklinks(fakeDb(pages, links), { page: target, reader: readerA });
    const own = result.unlinkedMentions.find((m) => m.id === "a3")!;
    const kernel = result.unlinkedMentions.find((m) => m.id === "k4")!;

    expect(own.linkItHref).toBe("/coworker-decisions/edit/stances/mentions?linkTo=entities%2Fcsdm");
    expect(kernel.linkItHref).toBeNull();
  });

  it("with no reader organization, no organization page is ever a mention candidate", async () => {
    const result = await loadWikiBacklinks(fakeDb(pages, links), {
      page: target,
      reader: { organizationId: null, professionFamilies: null, familyKey: null },
    });
    expect(result.unlinkedMentions.map((m) => m.id)).toEqual(["k4"]);
  });
});

describe("link context snippets", () => {
  it("shows the target by its title, other links by name, decodes stored entities, and cuts at word boundaries", async () => {
    const long = "word ".repeat(30);
    const source = page({
      id: "k5",
      slug: "stances/s",
      title: "S",
      isKernel: true,
      body: `${long}ServiceNow&#39;s CMDB, consolidating on [[entities/csdm]] and [[entities/it4it]] instead. ${long}`,
    });
    const result = await loadWikiBacklinks(fakeDb([target, source], [{ fromPageId: "k5", toPageId: "k-csdm" }]), {
      page: target,
      reader: readerA,
    });
    const context = result.linkedFrom[0]!.rows[0]!.context!;

    expect(context).toContain("ServiceNow's CMDB, consolidating on CSDM and it4it instead.");
    expect(context).not.toContain("[[");
    expect(context).toMatch(/^…word /);
    expect(context).toMatch(/ word…$/);
  });
});
