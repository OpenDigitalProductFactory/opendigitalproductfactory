// scripts/measure-doc-staleness-coverage.test.mjs
// BI-3E5969DF. Tests the pure arithmetic of the coverage measurement. If these
// numbers are wrong the report argues for the wrong decision, so they get the
// same scrutiny as a gate would.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENERATED_DOCS,
  computeCoverage,
  docArea,
  parseStalenessCandidates,
  renderReport,
} from "./measure-doc-staleness-coverage.mjs";

const CORPUS = [
  "docs/architecture/platform-overview.md", // both
  "docs/architecture/data-model.md", // code only
  "docs/user-guide/audit.md", // route only
  "docs/user-guide/getting-started/first-run.md", // uncovered
  "docs/index.md", // uncovered, root area
];

const MANIFEST = {
  docToCode: {
    "docs/architecture/platform-overview.md": ["apps/web/lib/docs-route-map.ts"],
    "docs/architecture/data-model.md": ["packages/db/prisma/schema.prisma"],
  },
  docToRoutes: {
    "docs/architecture/platform-overview.md": ["/architecture"],
    "docs/user-guide/audit.md": ["/platform/audit"],
  },
};

test("classifies each page by which edges reach it", () => {
  const cov = computeCoverage(CORPUS, MANIFEST);

  assert.equal(cov.total, 5);
  assert.equal(cov.byBoth, 1);
  assert.equal(cov.byCodeOnly, 1);
  assert.equal(cov.byRouteOnly, 1);
  assert.equal(cov.covered, 3);
  assert.equal(cov.uncovered, 2);
  assert.equal(cov.coveredPct, 60);
});

test("a page is counted once even when both edge kinds reach it", () => {
  // The bug this guards: summing byCode + byRoute double-counts overlap and
  // reports coverage HIGHER than it is — an over-optimistic number here would
  // argue for gating when the corpus cannot support it.
  const cov = computeCoverage(CORPUS, MANIFEST);
  assert.equal(cov.byCodeOnly + cov.byRouteOnly + cov.byBoth, cov.covered);
  assert.equal(cov.covered + cov.uncovered, cov.total);
});

test("ignores manifest entries that are not in the published corpus", () => {
  // docs/superpowers/** is excluded from the site; an edge to it must not inflate
  // coverage of the pages customers can actually read.
  const cov = computeCoverage(["docs/a.md"], {
    docToCode: { "docs/a.md": ["x.ts"], "docs/superpowers/plan.md": ["y.ts"] },
  });
  assert.equal(cov.total, 1);
  assert.equal(cov.covered, 1);
  assert.equal(cov.coveredPct, 100);
});

test("reports areas darkest-first", () => {
  const cov = computeCoverage(CORPUS, MANIFEST);
  const names = cov.areas.map((a) => a.area);

  // user-guide is 1/2 = 50%, architecture is 2/2 = 100%, root is 0/1 = 0%.
  assert.deepEqual(names, ["(root)", "user-guide", "architecture"]);
  assert.equal(cov.areas.find((a) => a.area === "architecture").coveredPct, 100);
  assert.equal(cov.areas.find((a) => a.area === "user-guide").coveredPct, 50);
});

test("handles an empty corpus without dividing by zero", () => {
  const cov = computeCoverage([], {});
  assert.equal(cov.total, 0);
  assert.equal(cov.coveredPct, 0);
  assert.deepEqual(cov.areas, []);
});

test("docArea splits on the first segment under docs/", () => {
  assert.equal(docArea("docs/user-guide/getting-started/x.md"), "user-guide");
  assert.equal(docArea("docs/index.md"), "(root)");
});

test("parses the candidate count out of the staleness report", () => {
  assert.equal(parseStalenessCandidates("**3** stale-candidate doc(s)."), 3);
  assert.equal(parseStalenessCandidates("**0** stale-candidate doc(s)."), 0);
  assert.equal(parseStalenessCandidates("no such line"), null);
});

test("renders deterministically — same input, byte-identical report", () => {
  // The report is committed and freshness-checked with --check; a non-reproducible
  // render would fail CI on an unchanged tree.
  const cov = computeCoverage(CORPUS, MANIFEST);
  assert.equal(renderReport(cov, 3), renderReport(cov, 3));
});

test("excludes its own output from the corpus it measures", () => {
  // Without this the report is part of the corpus the moment it is written, the
  // total grows by one, and `--check` reports the just-written file as stale.
  assert.ok(GENERATED_DOCS.has("docs/maintenance/staleness-coverage.md"));
  assert.ok(GENERATED_DOCS.has("docs/maintenance/staleness-report.md"));
});

test("report states the uncovered count, not just the covered share", () => {
  // The uncovered number is the finding. A report that led with 60% coverage and
  // omitted the 2 dark pages would read as reassurance.
  const out = renderReport(computeCoverage(CORPUS, MANIFEST), 3);
  assert.match(out, /3 of 5 published doc pages \(60%\)/);
  assert.match(out, /\| \*\*No edge at all\*\* \| \*\*2\*\* \|/);
});
