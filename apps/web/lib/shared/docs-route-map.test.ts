import { describe, expect, it } from "vitest";
import { loadDocPage } from "./docs";
import {
  DOC_ROUTE_MATCHERS,
  resolveDocsTarget,
  getMappedDocSlugs,
} from "./docs-route-map";

describe("resolveDocsTarget", () => {
  it("opens the Build Studio guide from Build Studio pages", () => {
    expect(resolveDocsTarget("/build").href).toBe("/docs/build-studio/index?from=%2Fbuild");
    expect(resolveDocsTarget("/build/FB-12345678").slug).toBe("build-studio/index");
  });

  it("opens the AI Workforce guide from platform AI pages", () => {
    expect(resolveDocsTarget("/platform/ai/providers").href).toBe(
      "/docs/ai-workforce/index?from=%2Fplatform%2Fai%2Fproviders",
    );
  });

  it("falls back to all docs when no route-specific documentation exists", () => {
    expect(resolveDocsTarget("/unknown/product-area").href).toBe(
      "/docs?from=%2Funknown%2Fproduct-area",
    );
    expect(resolveDocsTarget("/unknown/product-area").matched).toBe(false);
  });

  it("does not add a from parameter when already in documentation", () => {
    expect(resolveDocsTarget("/docs/build-studio/index").href).toBe("/docs");
  });
});

describe("DOC_ROUTE_MATCHERS", () => {
  it("points every mapped route at an existing documentation page", () => {
    for (const slug of getMappedDocSlugs()) {
      expect(loadDocPage(slug), slug).not.toBeNull();
    }
  });

  it("covers every authenticated shell section with a local documentation target", () => {
    const expectedSections = [
      "/admin",
      "/build",
      "/complaints",
      "/compliance",
      "/customer",
      "/ea",
      "/employee",
      "/finance",
      "/inventory",
      "/knowledge",
      "/ops",
      "/platform",
      "/portfolio",
      "/storefront",
      "/workspace",
    ];

    for (const section of expectedSections) {
      expect(
        DOC_ROUTE_MATCHERS.some((matcher) => section === matcher.route || section.startsWith(`${matcher.route}/`)),
        `${section} needs a route-specific documentation mapping`,
      ).toBe(true);
    }
  });
});
