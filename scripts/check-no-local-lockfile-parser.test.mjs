// Tests for the hand-written pnpm-lock parser ratchet (plan 2026-09-08 §10.5 S3).
// Run: node --test scripts/check-no-local-lockfile-parser.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { ALLOWLIST, findParserLines, findStaleAllowlist, scanRepo } from "./check-no-local-lockfile-parser.mjs";

test("flags string-literal section anchors", () => {
  assert.equal(findParserLines('const i = lines.indexOf("importers:");').length, 1);
  assert.equal(findParserLines("topLevelSection(lines, 'snapshots:')").length, 1);
});

test("flags regex-literal section anchors", () => {
  assert.equal(findParserLines("if (/^importers:\\s*$/.test(line)) {").length, 1);
  assert.equal(findParserLines("if (/^snapshots:/.test(line)) {").length, 1);
});

test("ignores comments, imports and workspace-file `packages:` parsing", () => {
  assert.equal(findParserLines('// walks "importers:" by hand').length, 0);
  assert.equal(findParserLines(' * lines.indexOf("snapshots:")').length, 0);
  assert.equal(findParserLines('import { parseImporters } from "./lib/pnpm-lock.mjs";').length, 0);
  assert.equal(findParserLines("if (/^packages:\\s*$/.test(line)) {").length, 0);
});

test("allowlist is closed and empty", () => {
  assert.equal(ALLOWLIST.size, 0);
});

test("repo: no script outside the shared reader parses the lockfile by hand", () => {
  assert.deepEqual(scanRepo(), []);
  assert.deepEqual(findStaleAllowlist(), []);
});
