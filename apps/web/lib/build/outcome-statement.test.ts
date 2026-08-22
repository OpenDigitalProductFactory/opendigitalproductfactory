import { describe, expect, it } from "vitest";

import { OUTCOME_STATEMENT_MAX, toOutcomeStatement } from "./owner-change-view";

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
