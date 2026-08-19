// Self-test for check-no-retired-lib-namespaces.mjs (W10 ratchet, BI-AB17E1A8).
// Proves the guard logic on synthetic trees, then asserts the REAL tree is
// clean (the ratchet's steady state) and that the registry stays aligned with
// its documented homes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RETIRED_DIRECTORIES,
  RETIRED_DIRECTORY_HOMES,
  RETIRED_FILE_PATTERNS,
  findRetiredNamespaceViolations,
} from "./check-no-retired-lib-namespaces.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fakeTree(map) {
  return (relDir) => (relDir in map ? map[relDir] : null);
}

test("clean tree (all retired dirs absent) passes", () => {
  assert.deepEqual(findRetiredNamespaceViolations(fakeTree({})), []);
});

test("empty husk directory is tolerated (git cannot track it)", () => {
  const violations = findRetiredNamespaceViolations(
    fakeTree({ "apps/web/lib/integrate": [] }),
  );
  assert.deepEqual(violations, []);
});

test("a file reappearing in a retired directory fails", () => {
  const violations = findRetiredNamespaceViolations(
    fakeTree({ "apps/web/lib/integrate": ["new-connector.ts"] }),
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "retired-directory");
  assert.equal(violations[0].directory, "apps/web/lib/integrate");
  assert.deepEqual(violations[0].entries, ["new-connector.ts"]);
  assert.match(violations[0].home, /integrations|build/);
});

test("every retired directory is enforced", () => {
  for (const dir of RETIRED_DIRECTORIES) {
    const violations = findRetiredNamespaceViolations(
      fakeTree({ [dir]: ["escapee.ts"] }),
    );
    assert.equal(violations.length, 1, `${dir} must be enforced`);
    assert.equal(violations[0].directory, dir);
  }
});

test("storefront-* under lib/release fails; other release modules pass", () => {
  const clean = findRetiredNamespaceViolations(
    fakeTree({ "apps/web/lib/release": ["branding.ts", "index.ts"] }),
  );
  assert.deepEqual(clean, []);
  const dirty = findRetiredNamespaceViolations(
    fakeTree({
      "apps/web/lib/release": ["branding.ts", "storefront-widgets.ts"],
    }),
  );
  assert.equal(dirty.length, 1);
  assert.equal(dirty[0].kind, "retired-file-pattern");
  assert.deepEqual(dirty[0].entries, ["storefront-widgets.ts"]);
});

test("multiple violations are all reported", () => {
  const violations = findRetiredNamespaceViolations(
    fakeTree({
      "apps/web/lib/ops": ["a.ts"],
      "apps/web/lib/edge": ["b.ts"],
      "apps/web/lib/release": ["storefront-x.ts"],
    }),
  );
  assert.equal(violations.length, 3);
});

test("every retired directory documents its new home", () => {
  for (const dir of RETIRED_DIRECTORIES) {
    assert.ok(
      typeof RETIRED_DIRECTORY_HOMES[dir] === "string" &&
        RETIRED_DIRECTORY_HOMES[dir].length > 0,
      `${dir} needs a documented home`,
    );
  }
});

test("documented homes exist in the real tree", () => {
  const homes = [
    "apps/web/lib/integrations",
    "apps/web/lib/build",
    "apps/web/lib/operate",
    "apps/web/lib/workspace-home",
    "apps/web/lib/edge-node",
    "apps/web/lib/platform",
    ...RETIRED_FILE_PATTERNS.map((p) => p.home),
  ];
  for (const home of homes) {
    assert.ok(existsSync(join(REPO_ROOT, home)), `${home} must exist`);
  }
});

test("the real tree is currently clean", () => {
  for (const dir of RETIRED_DIRECTORIES) {
    assert.ok(
      !existsSync(join(REPO_ROOT, dir)),
      `${dir} should not exist after the W10 seam`,
    );
  }
});
