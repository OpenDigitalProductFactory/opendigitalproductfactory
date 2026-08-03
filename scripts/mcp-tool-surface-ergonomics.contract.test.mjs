// scripts/mcp-tool-surface-ergonomics.contract.test.mjs - BI-5FE9DF99
// Keeps the MCP tool-surface ergonomics audit checklist present and citable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/architecture/mcp-tool-surface-ergonomics-audit.md";

test("MCP tool-surface ergonomics audit exists and names BI-5FE9DF99", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /BI-5FE9DF99/);
  assert.match(doc, /Tool-Surface Ergonomics/i);
  assert.match(doc, /agent-harness/i);
});

test("audit maps harness tool-plane mechanics", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /MCP server/i);
  assert.match(doc, /Deferred tool loading/i);
  assert.match(doc, /Permission planes/i);
  assert.match(doc, /governedExecuteTool|governed execution/i);
});

test("audit requires name, schema, grant, budget, and audit axes", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const axis of [
    "Name and discoverability",
    "Schema ergonomics",
    "Grant and population fit",
    "Budget and deferred loading",
    "Audit and evidence",
  ]) {
    assert.match(doc, new RegExp(axis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
