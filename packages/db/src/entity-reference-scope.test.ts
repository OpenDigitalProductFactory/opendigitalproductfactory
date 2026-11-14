import { describe, expect, it } from "vitest";

import {
  planReferenceEdges,
  recordScope,
  referenceDirectionAllowed,
  wikiPageScope,
  type ReferenceSource,
  type ReferenceTarget,
} from "./entity-reference-scope";

const NOW = new Date("2026-11-06T00:00:00.000Z");
const KERNEL = wikiPageScope({ slug: "principles/no-assumptions", organizationId: null });
const PROFESSION = wikiPageScope({ slug: "professions/finance/close", organizationId: null });
const ORG_A = recordScope("org-a");
const ORG_B = recordScope("org-b");
const INSTALL = recordScope(null);

describe("reference scopes (spec §2 R4, §3.2)", () => {
  it("derives a wiki page's corpus from organization and slug", () => {
    expect(KERNEL).toEqual({ corpus: "kernel", organizationId: null, family: null });
    expect(PROFESSION).toEqual({ corpus: "profession", organizationId: null, family: "finance" });
    expect(wikiPageScope({ slug: "overlay/x", organizationId: "org-a" })).toEqual({ corpus: "organization", organizationId: "org-a", family: null });
    expect(INSTALL).toEqual({ corpus: "install", organizationId: null, family: null });
  });

  it("lets WWWD records reference WWMD and WSID pages", () => {
    for (const source of [ORG_A, INSTALL]) {
      expect(referenceDirectionAllowed(source, KERNEL)).toBe(true);
      expect(referenceDirectionAllowed(source, PROFESSION)).toBe(true);
    }
  });

  it("refuses kernel and profession pages referencing WWWD records (AC-KLR-4)", () => {
    for (const source of [KERNEL, PROFESSION]) {
      expect(referenceDirectionAllowed(source, ORG_A)).toBe(false);
      expect(referenceDirectionAllowed(source, INSTALL)).toBe(false);
    }
    expect(referenceDirectionAllowed(PROFESSION, KERNEL)).toBe(true);
  });

  it("never crosses customer estates", () => {
    expect(referenceDirectionAllowed(ORG_A, ORG_B)).toBe(false);
    expect(referenceDirectionAllowed(ORG_A, ORG_A)).toBe(true);
    expect(referenceDirectionAllowed(INSTALL, ORG_A)).toBe(true);
    expect(referenceDirectionAllowed(ORG_A, INSTALL)).toBe(true);
  });
});

describe("planReferenceEdges", () => {
  const source: ReferenceSource = { kind: "backlog", key: "BI-SRC1", scope: ORG_A, field: "body", writtenBy: "user:u1" };
  const targets: ReferenceTarget[] = [
    { kind: "epic", key: "EP-T1", scope: INSTALL },
    { kind: "document", key: "DOC-OTHER", scope: ORG_B },
    { kind: "wiki", key: "page-kernel", scope: KERNEL },
    { kind: "backlog", key: "BI-SRC1", scope: ORG_A },
  ];

  it("keeps allowed targets, refuses R4 breaks, drops self-references and carries no content", () => {
    const plan = planReferenceEdges(source, targets, { now: NOW });
    expect(plan.edges.map((e) => e.dstKey)).toEqual(["EP-T1", "page-kernel"]);
    expect(plan.refused.map((t) => t.key)).toEqual(["DOC-OTHER"]);
    expect(plan.edges[0]!.props).toEqual({
      projection: "references",
      sourceKind: "backlog",
      sourceField: "body",
      sourceScope: "organization",
      sourceOrganizationId: "org-a",
      sourceFamily: null,
      targetKind: "epic",
      targetScope: "install",
      targetOrganizationId: null,
      targetFamily: null,
      roomId: null,
      writtenBy: "user:u1",
      syncedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(plan.edges)).not.toMatch(/title|snippet/);
  });

  it("is deterministic, so a re-run writes the same edges (AC-KLR-2)", () => {
    expect(planReferenceEdges(source, targets, { now: NOW })).toEqual(planReferenceEdges(source, [...targets], { now: NOW }));
  });

  it("keeps the original writer of an edge that already existed (R3 provenance)", () => {
    const plan = planReferenceEdges(source, targets, { now: NOW, existingWriters: new Map([["EP-T1", "agent:planter"]]) });
    expect(plan.edges.find((e) => e.dstKey === "EP-T1")!.props!.writtenBy).toBe("agent:planter");
    expect(plan.edges.find((e) => e.dstKey === "page-kernel")!.props!.writtenBy).toBe("user:u1");
  });

  it("a kernel page source produces no edge to a WWWD record", () => {
    const kernelSource: ReferenceSource = { kind: "wiki", key: "page-k", scope: KERNEL, field: "body", writtenBy: "user:u1" };
    const plan = planReferenceEdges(kernelSource, [{ kind: "backlog", key: "BI-X", scope: INSTALL }], { now: NOW });
    expect(plan.edges).toEqual([]);
    expect(plan.refused.map((t) => t.key)).toEqual(["BI-X"]);
  });
});
