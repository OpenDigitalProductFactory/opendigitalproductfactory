import { describe, expect, it, vi } from "vitest";

import type { WikiReader } from "./backlinks";
import {
  LINK_SUGGESTION_LIMIT,
  allowedTargetScopes,
  linkSourceScope,
  overlayLinkSourceScope,
  queryLinkCandidates,
  selectLinkSuggestions,
  type LinkCandidate,
} from "./link-suggest";

// BI-2F7BE778: link suggestions in the wiki editor. AC-KLE-1 (up to 8 readable
// matches) and AC-KLE-2 (scope direction R4; unreadable pages never offered, R1).

const reader: WikiReader = { organizationId: "org_acme", professionFamilies: null, familyKey: null };

function candidate(overrides: Partial<LinkCandidate>): LinkCandidate {
  return {
    id: overrides.slug ?? "id",
    slug: "entities/thing",
    title: "Thing",
    pageKind: "entity",
    organizationId: null,
    isKernel: true,
    kernelPageId: null,
    ...overrides,
  };
}

const kernelPage = candidate({ id: "k1", slug: "entities/budget", title: "Budget" });
const professionPage = candidate({ id: "p1", slug: "professions/finance/budget-control", title: "Budget control", isKernel: false });
const ownOrgPage = candidate({ id: "o1", slug: "entities/budget-policy", title: "Budget policy", organizationId: "org_acme", isKernel: false });
const otherOrgPage = candidate({ id: "x1", slug: "entities/budget-other", title: "Budget other", organizationId: "org_other", isKernel: false });

describe("scope direction (R4)", () => {
  it("lets an organization page link kernel, profession and organization pages", () => {
    expect(linkSourceScope({ slug: "entities/a", organizationId: "org_acme", isKernel: false })).toBe("organization");
    expect(allowedTargetScopes("organization")).toEqual(["kernel", "profession", "organization"]);
  });

  it("lets a profession page link only profession and kernel pages", () => {
    expect(linkSourceScope({ slug: "professions/finance/close", organizationId: null, isKernel: false })).toBe("profession");
    // An overlay written at a profession slug is still craft content: never point it at WWWD.
    expect(linkSourceScope({ slug: "professions/finance/close", organizationId: "org_acme", isKernel: false })).toBe("profession");
    expect(allowedTargetScopes("profession")).toEqual(["profession", "kernel"]);
    expect(overlayLinkSourceScope("professions/finance/close")).toBe("profession");
    expect(overlayLinkSourceScope("entities/customer-portal")).toBe("organization");
  });

  it("offers a kernel page nothing, because kernel pages are not edited in the runtime (R7)", () => {
    expect(linkSourceScope({ slug: "entities/a", organizationId: null, isKernel: true })).toBe("kernel");
    expect(allowedTargetScopes("kernel")).toEqual([]);
  });
});

describe("selectLinkSuggestions", () => {
  const all = [kernelPage, professionPage, ownOrgPage, otherOrgPage];

  it("never offers organization pages to a profession page (AC-KLE-2)", () => {
    const rows = selectLinkSuggestions(all, { reader, source: "profession", fromSlug: "professions/finance/close" });
    expect(rows.map((r) => r.slug)).toEqual(["entities/budget", "professions/finance/budget-control"]);
  });

  it("never offers a page the reader cannot read: another organization or a family outside the set (AC-KLE-2)", () => {
    const narrow: WikiReader = { organizationId: "org_acme", professionFamilies: new Set(["security"]), familyKey: "security" };
    const rows = selectLinkSuggestions(all, { reader: narrow, source: "organization", fromSlug: "entities/x" });
    expect(rows.map((r) => r.slug)).not.toContain("entities/budget-other");
    expect(rows.map((r) => r.slug)).not.toContain("professions/finance/budget-control");
    expect(rows.map((r) => r.slug)).toEqual(["entities/budget", "entities/budget-policy"]);
  });

  it("offers no organization page when the reader has no organization", () => {
    const rows = selectLinkSuggestions(all, {
      reader: { organizationId: null, professionFamilies: null, familyKey: null },
      source: "organization",
      fromSlug: "entities/x",
    });
    expect(rows.every((r) => r.scope !== "organization")).toBe(true);
  });

  it("caps at 8 and leaves out the page being edited (AC-KLE-1)", () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate({ id: `k${i}`, slug: `entities/budget-${i}`, title: `Budget ${i}` }));
    const rows = selectLinkSuggestions(many, { reader, source: "organization", fromSlug: "entities/budget-0" });
    expect(LINK_SUGGESTION_LIMIT).toBe(8);
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.slug)).not.toContain("entities/budget-0");
  });

  it("shows the reader's overlay in place of the kernel page it overrides", () => {
    const override = candidate({ id: "ov", slug: "entities/budget", title: "Our budget", organizationId: "org_acme", isKernel: false, kernelPageId: "k1" });
    const rows = selectLinkSuggestions([kernelPage, override], { reader, source: "organization", fromSlug: "entities/x" });
    expect(rows).toEqual([{ slug: "entities/budget", title: "Our budget", pageKind: "entity", scope: "organization" }]);
  });

  it("ranks the reader's own family first, then kernel and organization, then other families (R5)", () => {
    const own = candidate({ id: "s1", slug: "professions/security/budget-threats", title: "Budget threats", isKernel: false });
    const finance: WikiReader = { organizationId: "org_acme", professionFamilies: new Set(["security", "finance"]), familyKey: "security" };
    const rows = selectLinkSuggestions([professionPage, kernelPage, own, ownOrgPage], { reader: finance, source: "organization", fromSlug: "x" });
    expect(rows.map((r) => r.slug)).toEqual([
      "professions/security/budget-threats",
      "entities/budget",
      "entities/budget-policy",
      "professions/finance/budget-control",
    ]);
  });
});

describe("queryLinkCandidates", () => {
  function captureDb() {
    const $queryRaw = vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => [] as never);
    return {
      db: { $queryRaw },
      sql: () => {
        const [strings, ...values] = $queryRaw.mock.calls[0]!;
        return { sql: strings.join("?"), values };
      },
    };
  }

  it("ranks by trigram similarity on title and slug, with the query bound as a parameter", async () => {
    const { db, sql } = captureDb();
    await queryLinkCandidates(db, { query: "bud", organizationId: "org_acme", scopes: ["kernel", "profession", "organization"] });
    expect(sql().sql).toMatch(/similarity\(/);
    expect(sql().sql).toMatch(/"title"/);
    expect(sql().sql).toMatch(/"slug"/);
    expect(sql().values).toContain("bud");
    expect(sql().values).toContain("org_acme");
  });

  it("pushes the scope into SQL: a profession source never asks for organization rows", async () => {
    const { db, sql } = captureDb();
    await queryLinkCandidates(db, { query: "bud", organizationId: "org_acme", scopes: ["profession", "kernel"] });
    expect(sql().values).not.toContain("org_acme");
  });

  it("asks nothing when no scope is allowed", async () => {
    const { db } = captureDb();
    expect(await queryLinkCandidates(db, { query: "bud", organizationId: "org_acme", scopes: [] })).toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
