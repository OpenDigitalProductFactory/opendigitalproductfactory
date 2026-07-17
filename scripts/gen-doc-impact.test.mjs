// scripts/gen-doc-impact.test.mjs
// Run: node --test scripts/gen-doc-impact.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatterList } from "./gen-doc-impact.mjs";

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
