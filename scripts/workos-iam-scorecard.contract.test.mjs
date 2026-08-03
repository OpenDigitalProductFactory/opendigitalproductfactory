// scripts/workos-iam-scorecard.contract.test.mjs — BI-E2A4F3AA
// Keeps the WorkOS-equivalence / DPF ownership scorecard present and citable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/architecture/workos-iam-equivalence-scorecard.md";

test("WorkOS IAM scorecard exists and names BI-E2A4F3AA", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /BI-E2A4F3AA/);
  assert.match(doc, /WorkOS-Equivalence Scorecard/i);
  assert.match(doc, /EP-COMPANY-IAM-FOUNDATION/);
});

test("ownership classes are a closed set", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const cls of [
    "DPF-owned core",
    "Identity-edge adapter",
    "Optional hosted acceleration",
    "Non-goal",
  ]) {
    assert.match(doc, new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("scorecard covers login, SSO, SCIM, RBAC, MCP auth, and setup UX", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const needle of [
    "AuthKit-style login",
    "Enterprise SSO",
    "SCIM",
    "RBAC",
    "MCP Auth",
    "Setup UX",
    "Never make WorkOS",
  ]) {
    assert.match(doc, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
