import { describe, expect, it } from "vitest";

import {
  OUTCOME_STATEMENT_MAX,
  clampStatement,
  isSameStatement,
  toOutcomeStatement,
  toProseStatement,
} from "./owner-change-view";

// The literal shape the operator hit: the Outcome slot rendered the WHOLE
// markdown BI body as one plain <p>, so `##`, `>` and `**` appeared on screen.
const REAL_BI_BODY = `## Problem
On the owner cockpit (\`/workspace\`), the attention card reads:
> **Choose how to fix this for customers?**

The question mark makes it ungrammatical.

## Scope
**In scope:** rewrite the four \`copy.ts\` entries.
**Out of scope:** the other 16 headlines.`;

describe("toOutcomeStatement", () => {
  it("reduces a full markdown BI body to one readable sentence", () => {
    const out = toOutcomeStatement(REAL_BI_BODY);
    expect(out).toBe(
      "On the owner cockpit (/workspace), the attention card reads: Choose how to fix this for customers?",
    );
  });

  it("never leaks markdown structure to the operator", () => {
    const out = toOutcomeStatement(REAL_BI_BODY);
    for (const marker of ["##", "**", "> ", "`"]) {
      expect(out, `must not contain ${marker}`).not.toContain(marker);
    }
  });

  it("passes a short, well-formed outcome through untouched", () => {
    const clean = "Let owners rotate API keys without losing access for live tenants.";
    expect(toOutcomeStatement(clean)).toBe(clean);
  });

  it("skips a leading heading and takes the prose beneath it", () => {
    expect(toOutcomeStatement("## Problem\n\nThe invoice total is wrong for multi-currency customers."))
      .toBe("The invoice total is wrong for multi-currency customers.");
  });

  it("stops at the first paragraph rather than concatenating the whole doc", () => {
    const out = toOutcomeStatement("First paragraph here.\n\nSecond paragraph should not appear.");
    expect(out).toBe("First paragraph here.");
  });

  it("strips structure even when a body is headings and bullets only", () => {
    const out = toOutcomeStatement("## Scope\n- one\n- two");
    expect(out).not.toContain("##");
    expect(out).not.toContain("- ");
  });

  it("drops fenced code blocks", () => {
    const out = toOutcomeStatement("Fix the parser.\n\n```ts\nconst x = 1;\n```");
    expect(out).toBe("Fix the parser.");
    expect(out).not.toContain("const x");
  });

  it("reduces a link to its label", () => {
    expect(toOutcomeStatement("See [the runbook](https://example.com/r) for detail."))
      .toBe("See the runbook for detail.");
  });

  it("clamps an over-long statement at a sentence boundary when there is one", () => {
    const first = `${"word ".repeat(30).trim()}.`;
    const out = toOutcomeStatement(`${first} ${"tail ".repeat(60).trim()}.`);
    expect(out.length).toBeLessThanOrEqual(OUTCOME_STATEMENT_MAX);
    expect(out).toBe(first);
  });

  it("clamps on a word boundary with an ellipsis when there is no sentence break", () => {
    const out = toOutcomeStatement("x".repeat(40) + " " + "y".repeat(400));
    expect(out.length).toBeLessThanOrEqual(OUTCOME_STATEMENT_MAX + 1);
    expect(out.endsWith("…")).toBe(true);
    // Never mid-word before the ellipsis.
    expect(out).not.toMatch(/y…$/);
  });

  it("returns empty for empty input rather than inventing copy", () => {
    expect(toOutcomeStatement("")).toBe("");
    expect(toOutcomeStatement("   \n  ")).toBe("");
  });
});

describe("isSameStatement — the same sentence must not render twice", () => {
  const intake =
    "On the Build Studio page, the technical details drawer shows the build's brief as raw markdown — owners see literal \"## Problem\" characters instead of formatted text.";

  it("matches a string against itself", () => {
    expect(isSameStatement(intake, intake)).toBe(true);
  });

  it("matches a clamped form against its original", () => {
    // The real case: title is the raw intake, the heading is a clamped form of
    // it, and the outcome paragraph is the stripped form. All one sentence.
    expect(isSameStatement(toOutcomeStatement(intake), intake)).toBe(true);
    expect(isSameStatement(clampStatement(toProseStatement(intake), 96), intake)).toBe(true);
  });

  it("ignores markdown, case and punctuation differences", () => {
    expect(isSameStatement("## Fix the invoice total", "Fix the invoice total.")).toBe(true);
  });

  it("does NOT match two genuinely different statements", () => {
    expect(isSameStatement(intake, "Let owners rotate API keys without downtime.")).toBe(false);
  });

  it("does not match on a short coincidental prefix", () => {
    expect(isSameStatement("Fix the", "Fix the invoice total for multi-currency customers")).toBe(false);
  });

  it("treats empty input as not-the-same rather than suppressing a real slot", () => {
    expect(isSameStatement("", "anything")).toBe(false);
    expect(isSameStatement(null, undefined)).toBe(false);
  });
});
