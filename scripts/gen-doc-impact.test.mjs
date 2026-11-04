// scripts/gen-doc-impact.test.mjs
// Run: node --test scripts/gen-doc-impact.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyFanoutCap,
  frontmatterList,
  linkedCodePaths,
  tickedCodePaths,
} from "./gen-doc-impact.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("frontmatterList parses a YAML block list", () => {
  const md = ["---", "title: X", "relatedCode:", "  - apps/web/lib/a.ts", "  - scripts/b.sh", "order: 1", "---", "body"].join("\n");
  assert.deepEqual(frontmatterList(md, "relatedCode"), ["apps/web/lib/a.ts", "scripts/b.sh"]);
});

test("frontmatterList parses an inline array", () => {
  const md = ["---", "relatedRoutes: [/finance/invoices, /finance/payments]", "---"].join("\n");
  assert.deepEqual(frontmatterList(md, "relatedRoutes"), ["/finance/invoices", "/finance/payments"]);
});

test("frontmatterList returns empty when the key is absent", () => {
  const md = ["---", "title: X", "order: 2", "---"].join("\n");
  assert.deepEqual(frontmatterList(md, "relatedCode"), []);
});

test("frontmatterList stops at the next top-level key", () => {
  const md = ["---", "relatedCode:", "  - apps/web/lib/a.ts", "title: X", "  - not-part-of-list", "---"].join("\n");
  assert.deepEqual(frontmatterList(md, "relatedCode"), ["apps/web/lib/a.ts"]);
});

test("frontmatterList only reads the frontmatter block, not the body", () => {
  const md = ["---", "title: X", "---", "relatedCode:", "  - body/not/frontmatter.ts"].join("\n");
  assert.deepEqual(frontmatterList(md, "relatedCode"), []);
});

// ── Derived doc → code edges ────────────────────────────────────────────────
// These close the opt-in gap: a page is covered because it already links to the
// source file, not because someone remembered to add `relatedCode:`.

const DOC = "docs/architecture/platform-overview.md";

test("linkedCodePaths derives an edge from a relative link into source", () => {
  const md = "See [the sync writer](../../packages/db/src/graph-sync.ts) for detail.\n";
  assert.deepEqual(linkedCodePaths(md, DOC, REPO_ROOT), ["packages/db/src/graph-sync.ts"]);
});

test("linkedCodePaths ignores .md links — doc->doc is a different concern", () => {
  assert.deepEqual(linkedCodePaths("[rb](../operations/disaster-recovery.md)\n", DOC, REPO_ROOT), []);
});

test("linkedCodePaths ignores external links and pure anchors", () => {
  const md = "[gh](https://github.com/x/y/a.ts)\n[m](mailto:x@y.z)\n[a](#s)\n";
  assert.deepEqual(linkedCodePaths(md, DOC, REPO_ROOT), []);
});

test("linkedCodePaths ignores links inside fenced blocks (examples, not references)", () => {
  const md = ["```md", "[ex](../../packages/db/src/graph-sync.ts)", "```", ""].join("\n");
  assert.deepEqual(linkedCodePaths(md, DOC, REPO_ROOT), []);
});

test("linkedCodePaths skips a link that does not resolve — the reference gate owns that", () => {
  assert.deepEqual(linkedCodePaths("[x](../../packages/db/src/not-here.ts)\n", DOC, REPO_ROOT), []);
});

test("linkedCodePaths refuses to escape the repo root", () => {
  assert.deepEqual(linkedCodePaths("[o](../../../../../../etc/passwd.sh)\n", DOC, REPO_ROOT), []);
});

test("linkedCodePaths captures Next.js route-group parens whole", () => {
  const md = "[r](../../apps/web/app/(shell)/docs/[[...slug]]/page.tsx)\n";
  assert.deepEqual(linkedCodePaths(md, DOC, REPO_ROOT), ["apps/web/app/(shell)/docs/[[...slug]]/page.tsx"]);
});

test("linkedCodePaths de-duplicates and sorts for a byte-stable manifest", () => {
  const md = "[a](../../packages/db/src/pg-graph.ts)\n[a2](../../packages/db/src/pg-graph.ts)\n[b](../../packages/db/src/graph-sync.ts)\n";
  assert.deepEqual(linkedCodePaths(md, DOC, REPO_ROOT),
    ["packages/db/src/graph-sync.ts", "packages/db/src/pg-graph.ts"]);
});

// ─── EDGE SOURCE 4: backtick-cited repo paths (BI-22207E9A) ──────────────────
// The link-only walk missed the form DPF docs actually use most — prose citing a
// path inline. Measured: this took published-page coverage from 15.5% to 29.4%.

test("tickedCodePaths derives an edge from a backtick-cited repo path", () => {
  const md = "See `scripts/gen-doc-impact.mjs` for the generator.";
  assert.deepEqual(tickedCodePaths(md, REPO_ROOT), ["scripts/gen-doc-impact.mjs"]);
});

test("tickedCodePaths ignores paths that do not exist", () => {
  // A citation is only an edge if it resolves; a typo is the Doc Reference
  // Integrity gate's finding to report, not a phantom edge here.
  assert.deepEqual(tickedCodePaths("`apps/web/lib/does-not-exist.ts`", REPO_ROOT), []);
});

test("tickedCodePaths ignores non-source extensions and prose in backticks", () => {
  assert.deepEqual(tickedCodePaths("`README.md` and `some phrase`", REPO_ROOT), []);
});

test("tickedCodePaths ignores citations inside fenced blocks", () => {
  // Fenced blocks hold EXAMPLES; same rule the link-derived source already obeys.
  const fence = "`".repeat(3);
  const md = [fence, "see `scripts/gen-doc-impact.mjs`", fence].join("\n");
  assert.deepEqual(tickedCodePaths(md, REPO_ROOT), []);
});

test("tickedCodePaths skips relative forms — those belong to the link source", () => {
  assert.deepEqual(tickedCodePaths("`./gen-doc-impact.mjs` `../x.ts`", REPO_ROOT), []);
});

test("tickedCodePaths de-duplicates repeat citations of one file", () => {
  const md = "`scripts/gen-doc-impact.mjs` again `scripts/gen-doc-impact.mjs`";
  assert.deepEqual(tickedCodePaths(md, REPO_ROOT), ["scripts/gen-doc-impact.mjs"]);
});

test("applyFanoutCap drops landmark files cited by too many pages", () => {
  // packages/db/src/seed.ts is named by 14 pages because it is the canonical
  // example of a seed file, not because 14 pages document it. Without the cap,
  // touching it would flag all 14 and the gate becomes the noise it exists to avoid.
  const candidates = [
    { code: "seed.ts", doc: "a.md" },
    { code: "seed.ts", doc: "b.md" },
    { code: "seed.ts", doc: "c.md" },
    { code: "narrow.ts", doc: "a.md" },
  ];
  assert.deepEqual(applyFanoutCap(candidates, 2), [{ code: "narrow.ts", doc: "a.md" }]);
});

test("applyFanoutCap keeps a file sitting exactly on the cap", () => {
  const candidates = [
    { code: "x.ts", doc: "a.md" },
    { code: "x.ts", doc: "b.md" },
  ];
  assert.equal(applyFanoutCap(candidates, 2).length, 2);
});

test("applyFanoutCap counts fan-out globally, not per document", () => {
  // A per-page decision cannot see that a path is cited by many pages — which is
  // exactly why the tick edges are collected first and capped after the walk.
  const candidates = [
    { code: "x.ts", doc: "a.md" },
    { code: "x.ts", doc: "b.md" },
    { code: "x.ts", doc: "c.md" },
  ];
  assert.deepEqual(applyFanoutCap(candidates, 2), []);
});
