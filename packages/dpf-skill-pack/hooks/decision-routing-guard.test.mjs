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

// ── BI-0F0BE69A: platform decisions phrased in product/roadmap register ───────
// These three are the VERBATIM questions that escaped the guard (exit 0) on
// 2026-07-23 while scoping the incumbent-application coverage capability. Each
// is a genuine platform/build decision: epic sequencing across three epics, a
// change to the closed SETUP_STEPS contract, and build-scope depth.

test("blocks epic-sequencing / roadmap-shaping menus (no engineering noun present)", () => {
  const v = decide(
    "AskUserQuestion",
    q(
      "How should this scope enter the roadmap, given ~40 related BIs are already filed across three epics?",
      "Scope shape",
      ["Thin keystone epic first", "Fold into EP-ASSET-INTELLIGENCE", "Start with BI-ECO-001 answer key"],
    ),
  );
  assert.equal(v.block, true);
  assert.match(v.reason, /principle_decide|dpf-decision-via-kernel/);
});

test("blocks a wizard-step / onboarding-placement menu", () => {
  const v = decide(
    "AskUserQuestion",
    q("Where should the customer be asked what they run today?", "Onboarding", [
      "Optional, skippable wizard step",
      "Post-setup guided lane",
      "COO-initiated conversation",
    ]),
  );
  assert.equal(v.block, true);
});

test("blocks 'how ambitious' build-depth menus (pronoun-free 'how' form)", () => {
  const v = decide(
    "AskUserQuestion",
    q("How ambitious should the sales output be in this first pass?", "Sales artifact", [
      "Data-rendered coverage view",
      "Exportable business case",
      "Defer entirely",
    ]),
  );
  assert.equal(v.block, true);
});

test("blocks on a code identifier alone, with zero decision vocabulary", () => {
  // SCREAMING_SNAKE constant, semantic id, repo path, filename — each on its own.
  assert.equal(decide("AskUserQuestion", q("Where does this go?", "Placement", ["Into SETUP_STEPS", "Somewhere else"])).block, true);
  assert.equal(decide("AskUserQuestion", q("Where does this go?", "Placement", ["Under EP-ASSET-INTELLIGENCE", "Standalone"])).block, true);
  assert.equal(decide("AskUserQuestion", q("Where does this go?", "Placement", ["packages/db/src/portfolio-sources/", "Elsewhere"])).block, true);
  assert.equal(decide("AskUserQuestion", q("Where does this go?", "Placement", ["In types.ts", "A new file"])).block, true);
});

// ── does NOT block operator-owned questions (narrow scope is the safeguard) ────

test("allows operator-owned naming / branding / business questions", () => {
  assert.equal(decide("AskUserQuestion", q("What should we name the product?", "Name", ["Nova", "Atlas"])).block, false);
  assert.equal(decide("AskUserQuestion", q("Which brand color do you prefer?", "Color", ["Blue", "Green"])).block, false);
  assert.equal(decide("AskUserQuestion", q("Target SMB or enterprise first?", "Market", ["SMB", "Enterprise"])).block, false);
});

test("BI-0F0BE69A: widened vocabulary still allows realistic operator-owned questions", () => {
  // Acronyms without underscores are not SCREAMING_SNAKE — "SMB", "HOA", "CRM"
  // must not read as code identifiers.
  assert.equal(decide("AskUserQuestion", q("Which market do we serve first?", "Market", ["SMB", "HOA"])).block, false);
  // Business/pricing/hiring calls carry no codebase signal.
  assert.equal(decide("AskUserQuestion", q("What should we charge for the managed tier?", "Pricing", ["$99/mo", "$149/mo"])).block, false);
  assert.equal(decide("AskUserQuestion", q("Do we hire a second support rep this quarter?", "Hiring", ["Yes", "Not yet"])).block, false);
  assert.equal(decide("AskUserQuestion", q("Which tagline reads better?", "Tagline", ["Run your business", "Own your business"])).block, false);
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
