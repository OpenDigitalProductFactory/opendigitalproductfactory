import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isExcludedFromSite,
  parseJekyllExcludes,
  publishedDocFiles,
} from "./published-doc-roots.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("parseJekyllExcludes reads the block list and stops at the next top-level key", () => {
  const yaml = [
    "title: Site",
    "exclude:",
    "  - superpowers",
    "  - Reference",
    '  - "architecture/ea-diagrams"',
    "  - trailing/slash/",
    "",
    "  # a comment inside the block is not a terminator",
    "  - after-comment.md",
    "defaults:",
    "  - scope: {}",
  ].join("\n");

  assert.deepEqual(parseJekyllExcludes(yaml), [
    "superpowers",
    "Reference",
    "architecture/ea-diagrams",
    "trailing/slash",
    "after-comment.md",
  ]);
});

test("parseJekyllExcludes returns empty when there is no exclude key", () => {
  assert.deepEqual(parseJekyllExcludes("title: Site\nurl: https://example.com\n"), []);
});

test("isExcludedFromSite matches exact files and anything beneath a directory", () => {
  const excludes = ["superpowers", "notes.md"];
  assert.equal(isExcludedFromSite("superpowers", excludes), true);
  assert.equal(isExcludedFromSite("superpowers/specs/a.md", excludes), true);
  assert.equal(isExcludedFromSite("notes.md", excludes), true);
  // A sibling that merely shares a prefix is NOT excluded.
  assert.equal(isExcludedFromSite("superpowers-extra/a.md", excludes), false);
  assert.equal(isExcludedFromSite("architecture/platform-overview.md", excludes), false);
});

test("publishedDocFiles covers architecture, not just the user guide", () => {
  const files = publishedDocFiles(REPO_ROOT);
  // The regression this module exists to prevent: the page that described a
  // retired datastore was invisible to the doc-impact graph.
  assert.ok(files.includes("docs/architecture/platform-overview.md"));
  assert.ok(files.some((f) => f.startsWith("docs/user-guide/")));
  assert.ok(files.some((f) => f.startsWith("docs/operations/")));
});

test("publishedDocFiles honours docs/_config.yml exclusions and Jekyll conventions", () => {
  const files = publishedDocFiles(REPO_ROOT);
  const excludes = parseJekyllExcludes(
    fs.readFileSync(path.join(REPO_ROOT, "docs", "_config.yml"), "utf-8"),
  );
  assert.ok(excludes.includes("superpowers"), "fixture assumption: superpowers is excluded");

  // Frozen spec history is excluded from the site, so it must not gate docs.
  assert.equal(files.some((f) => f.startsWith("docs/superpowers/")), false);
  // Underscore dirs are Jekyll internals, never published pages.
  assert.equal(files.some((f) => f.startsWith("docs/_")), false);
  // Only markdown pages.
  assert.ok(files.every((f) => f.endsWith(".md")));
  // Deterministic ordering keeps the generated manifest stable.
  assert.deepEqual(files, [...files].sort());
});
