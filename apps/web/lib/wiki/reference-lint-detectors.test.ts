import { describe, expect, it } from "vitest";

import { runDetectors, type LintWikiPage } from "./lint-detectors";
import { detectKernelEntityCitations, detectScopeCrossingReferences } from "./reference-lint-detectors";

// BI-A63A9476 AC-KLR-4: the writer refuses kernel/profession → WWWD edges, and
// lint reports any such edge that exists anyway (written before the rule, or by
// a writer that bypassed it).

function page(overrides: Partial<LintWikiPage>): LintWikiPage {
  return {
    id: "wp", slug: "principles/x", title: "X", body: "", pageKind: "principle", status: "published",
    isKernel: true, kernelVersion: "1", organizationId: null, kernelPageId: null, derivedFromKernelVersion: null, ...overrides,
  };
}

describe("detectScopeCrossingReferences (AC-KLR-4)", () => {
  it("reports a stored edge from a kernel or profession page to a WWWD record as an error", () => {
    const findings = detectScopeCrossingReferences({
      references: [
        { srcKey: "wp-kernel", dstKey: "BI-1", sourceScope: "kernel", targetScope: "install" },
        { srcKey: "wp-prof", dstKey: "DOC-1", sourceScope: "profession", targetScope: "organization" },
        { srcKey: "BI-2", dstKey: "wp-kernel", sourceScope: "organization", targetScope: "kernel" },
        { srcKey: "wp-prof", dstKey: "wp-kernel", sourceScope: "profession", targetScope: "kernel" },
      ],
    });
    expect(findings).toEqual([
      { organizationId: null, pageId: "wp-kernel", findingKind: "scope-crossing-reference", severity: "error", detail: { targetKey: "BI-1", sourceScope: "kernel", targetScope: "install" } },
      { organizationId: null, pageId: "wp-prof", findingKind: "scope-crossing-reference", severity: "error", detail: { targetKey: "DOC-1", sourceScope: "profession", targetScope: "organization" } },
    ]);
  });
});

describe("detectKernelEntityCitations", () => {
  it("reports entity ids in kernel and profession bodies at info level; organization pages are not reported", () => {
    const findings = detectKernelEntityCitations({
      pages: [
        page({ id: "k", body: "Shipped in BI-A63A9476 under EP-0237A305." }),
        page({ id: "p", slug: "professions/finance/x", isKernel: false, body: "`BI-CODE1` only in code" }),
        page({ id: "o", isKernel: false, organizationId: "org-a", body: "BI-ORG1" }),
      ],
    });
    expect(findings).toEqual([
      { organizationId: null, pageId: "k", findingKind: "kernel-entity-citation", severity: "info", detail: { ids: ["BI-A63A9476", "EP-0237A305"] } },
    ]);
  });

  it("runs as part of runDetectors", () => {
    const findings = runDetectors({
      pages: [page({ id: "k", body: "BI-1" })],
      links: [], sources: [], rawSources: [], currentKernelVersion: "1",
      references: [{ srcKey: "k", dstKey: "BI-1", sourceScope: "kernel", targetScope: "install" }],
    });
    expect(findings.map((f) => f.findingKind)).toEqual(expect.arrayContaining(["kernel-entity-citation", "scope-crossing-reference"]));
  });
});
