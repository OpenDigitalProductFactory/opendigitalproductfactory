/**
 * Plan 2026-09-08 M5 — tests for the one-markdown-renderer ratchet.
 * Run: node --test scripts/check-no-local-markdown-renderer.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ALLOWLIST,
  CANONICAL,
  findMarkdownImports,
  findStaleAllowlist,
  isExcludedFile,
  scanRepo,
} from "./check-no-local-markdown-renderer.mjs";

function withTree(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "markdown-guard-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("flags static, dynamic and require imports of markdown libraries", () => {
  assert.equal(findMarkdownImports('import MarkdownIt from "markdown-it";').length, 1);
  assert.equal(findMarkdownImports('import ReactMarkdown from "react-markdown";').length, 1);
  assert.equal(findMarkdownImports("import remarkGfm from 'remark-gfm';").length, 1);
  assert.equal(findMarkdownImports('const { marked } = await import("marked");').length, 1);
  assert.equal(findMarkdownImports('const md = require("markdown-it")();').length, 1);
  assert.equal(findMarkdownImports('import type Token from "markdown-it/lib/token.mjs";').length, 1);
  assert.equal(findMarkdownImports('import { toHtml } from "hast-util-to-html";').length, 1);
});

test("ignores the primitive itself, look-alike names and comments", () => {
  assert.equal(findMarkdownImports('import { renderMarkdown } from "@/lib/shared/markdown";').length, 0);
  assert.equal(findMarkdownImports('import { x } from "markdown-it-helpers-local";').length, 0);
  assert.equal(findMarkdownImports('import { markedFields } from "./marked";').length, 0);
  assert.equal(findMarkdownImports('// import ReactMarkdown from "react-markdown";').length, 0);
  assert.equal(findMarkdownImports(' * the old renderer was "react-markdown"').length, 0);
});

test("excludes tests, declarations and non-source files", () => {
  assert.equal(isExcludedFile("a.test.ts"), true);
  assert.equal(isExcludedFile("a.d.ts"), true);
  assert.equal(isExcludedFile("README.md"), true);
  assert.equal(isExcludedFile("a.tsx"), false);
});

test("the canonical home may import markdown-it; any other file may not", () => {
  withTree(
    {
      [CANONICAL]: 'import MarkdownIt from "markdown-it";\n',
      "apps/web/components/Other.tsx": 'import ReactMarkdown from "react-markdown";\n',
      "apps/web/components/Fine.tsx": 'import { MarkdownHtml } from "@/components/shared/MarkdownHtml";\n',
    },
    (root) => {
      const violations = scanRepo(root);
      assert.deepEqual(
        violations.map((v) => [v.file, v.module]),
        [["apps/web/components/Other.tsx", "react-markdown"]],
      );
    },
  );
});

test("the allowlist starts empty and has no stale entries", () => {
  assert.equal(ALLOWLIST.size, 0);
  assert.deepEqual(findStaleAllowlist(), []);
});

test("the repository has no markdown renderer outside the primitive", () => {
  assert.deepEqual(scanRepo(), []);
});
