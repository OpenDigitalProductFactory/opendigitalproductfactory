import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "./decision-routing-guard.mjs";

const q = (question, header, opts) => ({
  questions: [{ question, header, options: opts.map((label) => ({ label, description: "" })) }],
});

// ── blocks platform/build decisions asked without a kernel consultation ───────

test("blocks the observed 'spec-only vs spec+implementation' scope menu", () => {
  const v = decide(
    "AskUserQuestion",
    q("Should I write a spec only, or spec plus implementation on the branch?", "Approach", [
      "Spec only",
      "Spec + implementation",
    ]),
  );
  assert.equal(v.block, true);
  assert.match(v.reason, /principle_decide|dpf-decision-via-kernel/);
});

test("blocks the meta 'how far should I take this' menu (this session's own slip)", () => {
  const v = decide(
    "AskUserQuestion",
    q("How far should I take the findings?", "Next action", ["File BIs", "File + spec", "Nothing"]),
  );
  assert.equal(v.block, true);
});

test("blocks which-approach / architecture / refactor / schema-migration forks", () => {
  assert.equal(decide("AskUserQuestion", q("Which approach should we use?", "Approach", ["A", "B"])).block, true);
  assert.equal(decide("AskUserQuestion", q("Pick the architecture", "Arch", ["Monolith", "Services"])).block, true);
  assert.equal(decide("AskUserQuestion", q("Refactor or special-case?", "Refactor", ["Refactor", "Special-case"])).block, true);
  assert.equal(decide("AskUserQuestion", q("Schema migration shape?", "Migration", ["Shape A", "Shape B"])).block, true);
});

// ── does NOT block operator-owned questions (narrow scope is the safeguard) ────

test("allows operator-owned naming / branding / business questions", () => {
  assert.equal(decide("AskUserQuestion", q("What should we name the product?", "Name", ["Nova", "Atlas"])).block, false);
  assert.equal(decide("AskUserQuestion", q("Which brand color do you prefer?", "Color", ["Blue", "Green"])).block, false);
  assert.equal(decide("AskUserQuestion", q("Target SMB or enterprise first?", "Market", ["SMB", "Enterprise"])).block, false);
});

test("allows single-option / factual clarifications", () => {
  assert.equal(
    decide("AskUserQuestion", { questions: [{ question: "Which file did you mean — the schema?", header: "File", options: [{ label: "yes" }] }] }).block,
    false,
  );
});

// ── allows the legitimate escalation path (already consulted → surfacing) ──────

test("allows a decision question that surfaces the kernel ledger", () => {
  const v = decide(
    "AskUserQuestion",
    q(
      "principle_decide returned low confidence (margin 0.05) on this architecture choice — you decide:",
      "Approach",
      ["Option A", "Option B"],
    ),
  );
  assert.equal(v.block, false);
});

// ── honors bypasses ───────────────────────────────────────────────────────────

test("honors the env bypass and the per-call [operator-owned] tag", () => {
  const menu = q("Which implementation approach?", "Approach", ["A", "B"]);
  assert.equal(decide("AskUserQuestion", menu, { DPF_ALLOW_DIRECT_ASK: "1" }).block, false);
  const tagged = q("Which implementation approach? [operator-owned]", "Approach", ["A", "B"]);
  assert.equal(decide("AskUserQuestion", tagged).block, false);
});

// ── ignores non-AskUserQuestion tools and malformed input ─────────────────────

test("ignores other tools and malformed payloads (fails open)", () => {
  assert.equal(decide("Bash", { command: "which architecture" }).block, false);
  assert.equal(decide("AskUserQuestion", {}).block, false);
  assert.equal(decide("AskUserQuestion", { questions: "nope" }).block, false);
});
