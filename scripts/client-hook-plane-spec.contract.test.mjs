// scripts/client-hook-plane-spec.contract.test.mjs — BI-A56D77B6
// Pins Phase-1 client-hook plane β-bundle six lifecycle events in the design spec.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/superpowers/specs/2026-06-02-dpf-client-hook-plane-design.md";

test("client-hook plane Phase-1 spec exists and names BI-A56D77B6 or six-event β-bundle", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /six-event|six event|β-bundle|beta-bundle/i);
  assert.match(doc, /client-side governance plane|client-hook plane|Client Hook Plane/i);
});

test("spec defines the six lifecycle events", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const needle of [
    "PreToolUse: config-protection",
    "PreToolUse: bash-allowlist-validator",
    "SessionStart: memory-load",
    "PostToolUse: governance-capture",
  ]) {
    assert.match(doc, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // PreCompact + Stop are named in the six-event set
  assert.match(doc, /PreCompact/i);
  assert.match(doc, /### 5\. Stop:|Matcher: `Stop`|session-summary/i);
});

test("launcher block-mode amendment for PreToolUse is specified", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /may-block|--may-block|BLOCK mode/i);
  assert.match(doc, /run-hook\.mjs/);
});
