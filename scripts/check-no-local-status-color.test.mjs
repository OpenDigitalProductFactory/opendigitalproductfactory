// Self-test for the status→color-map ratchet (BI-81EE4A46).
import { test } from "node:test";
import assert from "node:assert/strict";

import { findDefinitionLines, DEFINITION_PATTERN } from "./check-no-local-status-color.mjs";

test("flags a local Record<…, Intent> map definition", () => {
  const body = `const STATUS_INTENT: Record<string, Intent> = {\n  open: "info",\n};`;
  const hits = findDefinitionLines(body);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
});

test("flags an exported map too", () => {
  const body = `export const TONE_INTENT: Record<Tone, Intent> = { a: "success" };`;
  assert.equal(findDefinitionLines(body).length, 1);
});

test("does NOT flag a StatusBadge domain/status usage", () => {
  const body = `<StatusBadge domain="backlogItem" status={s} />`;
  assert.equal(findDefinitionLines(body).length, 0);
});

test("does NOT flag an import of Intent", () => {
  const body = `import { intentStyle, type Intent } from "./statusColors";`;
  assert.equal(findDefinitionLines(body).length, 0);
});

test("does NOT flag a commented-out definition", () => {
  const body = `// const OLD: Record<string, Intent> = { a: "info" };`;
  assert.equal(findDefinitionLines(body).length, 0);
});

test("does NOT flag an unrelated Record type", () => {
  const body = `const LABELS: Record<string, string> = { a: "A" };`;
  assert.equal(DEFINITION_PATTERN.test(body), false);
});
