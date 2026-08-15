// scripts/check-docs-impact.test.mjs
// Run: node --test scripts/check-docs-impact.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRouteMap,
  routeForPageFile,
  docsPathForRoute,
  docFileForDocsPath,
  computeImpact,
  isDependencyOnlyChange,
} from "./check-docs-impact.mjs";

const SAMPLE_TS = `
const DOCS_ROUTE_MAP = [
  { routePrefix: "/finance/invoices", docsPath: "/docs/finance/accounts-receivable" },
  { routePrefix: "/finance", docsPath: "/docs/finance/index" },
  { routePrefix: "/build", docsPath: "/docs/build-studio/index" },
  { routePrefix: "/docs", docsPath: "/docs" },
];
`;

const ENTRIES = parseRouteMap(SAMPLE_TS);

test("parseRouteMap extracts every route->doc entry", () => {
  assert.equal(ENTRIES.length, 4);
  assert.deepEqual(ENTRIES[0], { routePrefix: "/finance/invoices", docsPath: "/docs/finance/accounts-receivable" });
});

test("routeForPageFile strips route groups and /page.tsx", () => {
  assert.equal(routeForPageFile("apps/web/app/(shell)/finance/invoices/page.tsx"), "/finance/invoices");
  assert.equal(routeForPageFile("apps/web/app/(shell)/portfolio/product/[productId]/page.tsx"), "/portfolio/product/[productId]");
  assert.equal(routeForPageFile("apps/web/app/(shell)/build/page.tsx"), "/build");
});

test("docsPathForRoute uses longest-prefix match", () => {
  assert.equal(docsPathForRoute("/finance/invoices", ENTRIES), "/docs/finance/accounts-receivable");
  assert.equal(docsPathForRoute("/finance/invoices/123", ENTRIES), "/docs/finance/accounts-receivable");
  assert.equal(docsPathForRoute("/finance/reports", ENTRIES), "/docs/finance/index");
  assert.equal(docsPathForRoute("/unmapped/route", ENTRIES), null);
});

test("docFileForDocsPath maps to the repo doc file", () => {
  assert.equal(docFileForDocsPath("/docs/finance/accounts-receivable"), "docs/user-guide/finance/accounts-receivable.md");
  assert.equal(docFileForDocsPath("/docs/build-studio/index"), "docs/user-guide/build-studio/index.md");
  assert.equal(docFileForDocsPath("/docs"), "docs/user-guide/index.md");
});

test("computeImpact flags a documented route change without its doc update", () => {
  const impacted = computeImpact(["apps/web/app/(shell)/finance/invoices/page.tsx"], ENTRIES);
  assert.equal(impacted.size, 1);
  assert.ok(impacted.has("docs/user-guide/finance/accounts-receivable.md"));
});

test("computeImpact is satisfied when the linked doc is updated in the same PR", () => {
  const impacted = computeImpact(
    ["apps/web/app/(shell)/finance/invoices/page.tsx", "docs/user-guide/finance/accounts-receivable.md"],
    ENTRIES,
  );
  assert.equal(impacted.size, 0);
});

test("computeImpact ignores undocumented routes", () => {
  const impacted = computeImpact(["apps/web/app/(shell)/unmapped/thing/page.tsx"], ENTRIES);
  assert.equal(impacted.size, 0);
});

test("computeImpact ignores non-page and test files", () => {
  const impacted = computeImpact(
    ["apps/web/app/(shell)/finance/invoices/page.test.tsx", "apps/web/app/api/finance/route.ts"],
    ENTRIES,
  );
  assert.equal(impacted.size, 0);
});

test("computeImpact flags a page whose relatedCode file changed", () => {
  const codeToDocs = { "apps/web/lib/ai-inference.ts": ["docs/user-guide/ai-workforce/connecting-providers.md"] };
  const impacted = computeImpact(["apps/web/lib/ai-inference.ts"], ENTRIES, codeToDocs);
  assert.equal(impacted.size, 1);
  assert.equal(impacted.get("docs/user-guide/ai-workforce/connecting-providers.md")[0].kind, "code");
});

test("computeImpact is satisfied when the code-linked doc is updated in the same PR", () => {
  const codeToDocs = { "apps/web/lib/ai-inference.ts": ["docs/user-guide/ai-workforce/connecting-providers.md"] };
  const impacted = computeImpact(
    ["apps/web/lib/ai-inference.ts", "docs/user-guide/ai-workforce/connecting-providers.md"],
    ENTRIES,
    codeToDocs,
  );
  assert.equal(impacted.size, 0);
});

test("computeImpact ignores changed code with no relatedCode edge", () => {
  const impacted = computeImpact(["apps/web/lib/unrelated.ts"], ENTRIES, { "apps/web/lib/ai-inference.ts": ["docs/x.md"] });
  assert.equal(impacted.size, 0);
});

test("computeImpact groups multiple routes onto one doc", () => {
  const impacted = computeImpact(
    ["apps/web/app/(shell)/finance/invoices/page.tsx", "apps/web/app/(shell)/finance/payments/page.tsx"],
    parseRouteMap(`const M=[{ routePrefix: "/finance", docsPath: "/docs/finance/index" }];`),
  );
  assert.equal(impacted.size, 1);
  assert.equal(impacted.get("docs/user-guide/finance/index.md").length, 2);
});

// Dependency-manifest-only exemption — the Dependabot wedge (#4184–4188). A doc
// may cite pnpm-lock.yaml/package.json, making them code->doc edges; the gate
// must NOT then require a bot-unauthorable Docs-Impact-Decision trailer for a
// diff that touches only dependency manifests.
test("isDependencyOnlyChange: root lockfile-only diff is exempt", () => {
  assert.equal(isDependencyOnlyChange(["pnpm-lock.yaml"]), true);
});

test("isDependencyOnlyChange: package.json + lockfile (every Dependabot PR shape) is exempt", () => {
  // Exact file sets of #4184–4188.
  assert.equal(isDependencyOnlyChange(["packages/db/package.json", "pnpm-lock.yaml"]), true); // #4184
  assert.equal(isDependencyOnlyChange(["apps/mobile/package.json", "pnpm-lock.yaml"]), true); // #4185/#4188
  assert.equal(isDependencyOnlyChange(["apps/web/package.json", "pnpm-lock.yaml"]), true); // #4186
  assert.equal(
    isDependencyOnlyChange(["apps/web/package.json", "packages/db/package.json", "pnpm-lock.yaml"]),
    true,
  ); // #4187
});

test("isDependencyOnlyChange: other package managers' lockfiles are exempt", () => {
  assert.equal(isDependencyOnlyChange(["package-lock.json"]), true);
  assert.equal(isDependencyOnlyChange(["yarn.lock", "package.json"]), true);
  assert.equal(isDependencyOnlyChange(["npm-shrinkwrap.json"]), true);
  assert.equal(isDependencyOnlyChange(["pnpm-workspace.yaml", "pnpm-lock.yaml"]), true);
});

test("isDependencyOnlyChange: a single source file alongside manifests defeats the exemption", () => {
  // The abuse case: the exemption must NOT let real code ride along with a bump.
  assert.equal(isDependencyOnlyChange(["pnpm-lock.yaml", "apps/web/lib/ai-inference.ts"]), false);
  assert.equal(isDependencyOnlyChange(["package.json", "apps/web/app/(shell)/finance/invoices/page.tsx"]), false);
});

test("isDependencyOnlyChange: a doc file alongside manifests defeats the exemption", () => {
  assert.equal(isDependencyOnlyChange(["pnpm-lock.yaml", "docs/user-guide/finance/index.md"]), false);
});

test("isDependencyOnlyChange: files merely named like manifests but nested elsewhere are not matched loosely", () => {
  // "package.jsonc" / "my-package.json.bak" must not count as a manifest.
  assert.equal(isDependencyOnlyChange(["config/package.jsonc"]), false);
  assert.equal(isDependencyOnlyChange(["tools/my-package.json.bak"]), false);
});

test("isDependencyOnlyChange: an empty diff is not exempt (falls through to normal OK)", () => {
  assert.equal(isDependencyOnlyChange([]), false);
});
