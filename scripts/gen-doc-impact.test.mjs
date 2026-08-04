// scripts/gen-doc-impact.test.mjs
// Run: node --test scripts/gen-doc-impact.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatterList, linkedCodePaths } from "./gen-doc-impact.mjs";

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
