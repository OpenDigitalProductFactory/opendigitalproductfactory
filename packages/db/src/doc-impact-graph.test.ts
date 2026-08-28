// packages/db/src/doc-impact-graph.test.ts
//
// BI-6C112948. These tests exercise the PURE planner only — no database.
// That is deliberate and load-bearing: the doc-impact gate must stay
// database-free (policy-guards-pr has no `services:` block), so the projection's
// correctness has to be provable without one too. The DB-touching half
// (projectDocImpactManifest) is exercised by the graph-sync integration lane.

import { describe, expect, it } from "vitest";
import {
  DOC_IMPACT_SOURCE_LABEL,
  DOC_PAGE_LABEL,
  docPageKey,
  countDocPagesInManifest,
  planDocImpactProjection,
  routeKey,
  sourceFileKey,
  type DocImpactManifest,
} from "./doc-impact-graph";

const MANIFEST: DocImpactManifest = {
  generatedBy: "scripts/gen-doc-impact.mjs",
  codeToDocs: {
    "apps/web/lib/docs-route-map.ts": ["docs/architecture/platform-overview.md"],
    "packages/db/prisma/schema.prisma": [
      "docs/architecture/platform-overview.md",
      "docs/architecture/data-model.md",
    ],
  },
  routeToDocs: {
    "/platform/audit": ["docs/user-guide/audit.md"],
  },
  // Inverses — present in the real manifest, deliberately ignored by the planner.
  docToCode: {
    "docs/architecture/platform-overview.md": ["apps/web/lib/docs-route-map.ts"],
  },
  docToRoutes: { "docs/user-guide/audit.md": ["/platform/audit"] },
};

describe("mirror keys", () => {
  it("reuses the Code Intelligence Graph's key space for files and routes", () => {
    // THE REGRESSION THIS PINS: keying a file by its bare path mints a SECOND node
    // for a file the code graph already has as "source-code:<path>". IMPORTS and
    // TESTED_BY would hang off one identity and IMPACTS off the other, and no
    // traversal could cross between them. Verified live: 4,215 CodeFile nodes.
    expect(sourceFileKey("apps/web/lib/docs-route-map.ts")).toBe(
      "source-code:apps/web/lib/docs-route-map.ts",
    );
    expect(routeKey("/platform/audit")).toBe("source-code:route:/platform/audit");
  });

  it("keeps doc pages in their own namespace", () => {
    // Docs are not code-graph artifacts. A separate namespace is what stops a
    // code-graph reconcile from rewriting or deleting them.
    expect(docPageKey("docs/user-guide/audit.md")).toBe("doc-impact:docs/user-guide/audit.md");
  });
});

describe("planDocImpactProjection", () => {
  it("labels shared source nodes additively, and doc pages as owned", () => {
    const byKey = new Map(planDocImpactProjection(MANIFEST).nodes.map((n) => [n.key, n.label]));

    // DocImpactSource, NOT CodeFile: graph-sync union-merges labels, so a file the
    // code graph indexes becomes one node labelled both — while a file it does not
    // index (.sh/.yml/.prisma) is not counterfeited as an indexed CodeFile.
    expect(byKey.get("source-code:apps/web/lib/docs-route-map.ts")).toBe(DOC_IMPACT_SOURCE_LABEL);
    expect(byKey.get("source-code:route:/platform/audit")).toBe(DOC_IMPACT_SOURCE_LABEL);
    expect(byKey.get("doc-impact:docs/architecture/platform-overview.md")).toBe(DOC_PAGE_LABEL);
  });

  it("never labels a shared node CodeFile", () => {
    // Claiming CodeFile would put nodes with no checksum into the code-structure
    // queries that filter on props->>'graphKey'.
    const labels = planDocImpactProjection(MANIFEST).nodes.map((n) => n.label);
    expect(labels).not.toContain("CodeFile");
    expect(labels).not.toContain("CodeRoute");
  });

  it("points edges from the thing that changed to the doc to review", () => {
    const { edges } = planDocImpactProjection(MANIFEST);

    // Blast radius runs src → dst: change the schema, review both pages.
    expect(edges).toContainEqual({
      srcKey: "source-code:packages/db/prisma/schema.prisma",
      dstKey: "doc-impact:docs/architecture/data-model.md",
      origin: "code",
    });
    expect(edges).toContainEqual({
      srcKey: "source-code:route:/platform/audit",
      dstKey: "doc-impact:docs/user-guide/audit.md",
      origin: "route",
    });
    // Never the other way round — a reverse edge would make "what does changing
    // this file affect?" walk into markdown and back out into unrelated code.
    expect(edges.some((e) => e.srcKey.startsWith("doc-impact:"))).toBe(false);
  });

  it("does not double-count the inverse maps", () => {
    // docToCode/docToRoutes describe the same facts as the forward maps. Reading
    // them too would double every edge and give each fact two owners.
    expect(planDocImpactProjection(MANIFEST).edges).toHaveLength(4);
  });

  it("collapses an edge declared twice into one", () => {
    // A page can BOTH declare `relatedCode:` and link the same file inline.
    const plan = planDocImpactProjection({ codeToDocs: { "a.ts": ["docs/a.md", "docs/a.md"] } });

    expect(plan.edges).toHaveLength(1);
    expect(plan.nodes.map((n) => n.key)).toEqual(["doc-impact:docs/a.md", "source-code:a.ts"]);
  });

  it("is deterministic and sorted, so re-projection is a no-op diff", () => {
    const a = planDocImpactProjection(MANIFEST);
    const b = planDocImpactProjection(MANIFEST);

    expect(a).toEqual(b);
    expect(a.nodes.map((n) => n.key)).toEqual([...a.nodes.map((n) => n.key)].sort());
    expect(a.edges.map((e) => `${e.srcKey} ${e.dstKey}`)).toEqual(
      [...a.edges.map((e) => `${e.srcKey} ${e.dstKey}`)].sort(),
    );
  });

  it("carries the un-prefixed path as a prop for readable queries", () => {
    const plan = planDocImpactProjection(MANIFEST);
    const file = plan.nodes.find((n) => n.key === "source-code:apps/web/lib/docs-route-map.ts");
    const doc = plan.nodes.find((n) => n.key === "doc-impact:docs/architecture/data-model.md");

    // `path` matches the prop name the code graph already uses on CodeFile, so a
    // shared node carries one spelling of the fact rather than two.
    expect(file?.props).toMatchObject({ path: "apps/web/lib/docs-route-map.ts", kind: "file" });
    expect(doc?.props).toMatchObject({ path: "docs/architecture/data-model.md", name: "data-model" });
  });

  it("tolerates an empty or partial manifest", () => {
    expect(planDocImpactProjection({})).toEqual({ nodes: [], edges: [] });
    expect(planDocImpactProjection({ routeToDocs: {} })).toEqual({ nodes: [], edges: [] });
    // A source with no impacted docs still exists as a node — it is a real file the
    // graph knows about that simply has no doc coverage. That absence is exactly
    // what a coverage query wants to find.
    const orphan = planDocImpactProjection({ codeToDocs: { "a.ts": [] } });
    expect(orphan.edges).toEqual([]);
    expect(orphan.nodes.map((n) => n.key)).toEqual(["source-code:a.ts"]);
  });
});

describe("countDocPagesInManifest", () => {
  it("counts DISTINCT doc pages, not every planned node", () => {
    // The fixture names three distinct docs across the two forward maps, and
    // platform-overview.md is referenced TWICE. The plan also contains
    // DocImpactSource markers for the two code files and the one route, so a
    // naive `plan.nodes.length` would answer 6 and a naive per-reference count
    // would answer 4. Either would report permanent phantom drift against a
    // correctly-projected mirror — a broken invariant is worse than none,
    // because it trains people to ignore the alarm.
    expect(countDocPagesInManifest(MANIFEST)).toBe(3);
  });

  it("agrees exactly with the DocPage nodes the projection writes", () => {
    // The invariant and the projection MUST share one derivation. This asserts
    // they cannot drift apart: if planDocImpactProjection ever changes which
    // docs it emits, this fails rather than silently reporting false drift.
    const planned = planDocImpactProjection(MANIFEST).nodes.filter(
      (n) => n.label === DOC_PAGE_LABEL,
    ).length;
    expect(countDocPagesInManifest(MANIFEST)).toBe(planned);
  });

  it("counts nothing for an empty manifest, so a fresh install is not a false fault", () => {
    expect(countDocPagesInManifest({})).toBe(0);
  });

  it("ignores the inverse maps the projection does not read", () => {
    // docToRoutes/docToCode are inverses. A count taken off them would report 1
    // here while the projection writes 0 DocPage nodes.
    expect(countDocPagesInManifest({ docToRoutes: { "docs/only-inverse.md": ["/x"] } })).toBe(0);
  });
});
