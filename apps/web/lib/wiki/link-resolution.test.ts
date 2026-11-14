import { describe, expect, it } from "vitest";

import { detectDanglingXrefs, type LintWikiPage } from "./lint-detectors";
import { buildWikiSlugIndex, danglingLinks, danglingTargets, resolvableSlugs } from "./link-resolution";

// BI-2F7BE778 AC-KLE-3: the dangling-link rule lint uses, moved out of
// detectDanglingXrefs so the editor checks a draft by the same rule.

const pages = [
  { slug: "entities/digital-product", organizationId: null },
  { slug: "professions/finance/close", organizationId: null },
  { slug: "entities/customer-portal", organizationId: "org_acme" },
  { slug: "entities/other-estate", organizationId: "org_other" },
];

describe("shared dangling-link resolver", () => {
  it("resolves an organization page against its own slugs and the null-organization slugs", () => {
    const slugs = resolvableSlugs(buildWikiSlugIndex(pages), "org_acme");
    expect([...slugs].sort()).toEqual([
      "entities/customer-portal",
      "entities/digital-product",
      "professions/finance/close",
    ]);
  });

  it("resolves a kernel page against null-organization slugs only", () => {
    const slugs = resolvableSlugs(buildWikiSlugIndex(pages), null);
    expect(slugs.has("entities/customer-portal")).toBe(false);
    expect(slugs.has("entities/digital-product")).toBe(true);
  });

  it("treats another organization's page as dangling", () => {
    const slugs = resolvableSlugs(buildWikiSlugIndex(pages), "org_acme");
    expect(danglingTargets("[[entities/other-estate]] and [[entities/digital-product]]", slugs)).toEqual([
      "entities/other-estate",
    ]);
  });

  it("lists each dangling link with its line, once per line", () => {
    const slugs = resolvableSlugs(buildWikiSlugIndex(pages), "org_acme");
    const body = ["See [[entities/missing]].", "Fine: [[entities/customer-portal|portal]].", "[[entities/missing]] and [[entities/missing]]"].join("\n");
    expect(danglingLinks(body, slugs)).toEqual([
      { slug: "entities/missing", line: 1 },
      { slug: "entities/missing", line: 3 },
    ]);
  });

  it("ignores links in code, as the extractor does", () => {
    const slugs = resolvableSlugs(buildWikiSlugIndex(pages), "org_acme");
    expect(danglingLinks("`see [[nowhere]]`", slugs)).toEqual([]);
  });

  it("gives the editor exactly the targets the dangling-xref lint finding names", () => {
    const body = "[[entities/digital-product]] [[entities/other-estate]] [[entities/missing|m]]";
    const lintPages: LintWikiPage[] = [...pages, { slug: "entities/draft", organizationId: "org_acme" }].map((p, i) => ({
      id: `wp${i}`,
      slug: p.slug,
      title: p.slug,
      body: p.slug === "entities/draft" ? body : "",
      pageKind: "entity",
      status: "draft",
      isKernel: p.organizationId === null,
      kernelVersion: null,
      organizationId: p.organizationId,
      kernelPageId: null,
      derivedFromKernelVersion: null,
    }));
    const [finding] = detectDanglingXrefs({ pages: lintPages });
    const editorView = danglingTargets(body, resolvableSlugs(buildWikiSlugIndex(lintPages), "org_acme"));
    expect(finding?.detail.danglingTargets).toEqual(editorView);
    expect(editorView).toEqual(["entities/other-estate", "entities/missing"]);
  });
});
