import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALLOCATION_PATTERNS,
  ELIGIBILITY_GATES,
  PERFORMER_KINDS,
  allowsAiExecution,
  isAllocationPattern,
  isPerformerKind,
  requiresHumanInControlPath,
  type AllocationPattern,
} from "./performer-allocation";

// THE POINT OF THIS FILE. A vocabulary copied out of a standard drifts from it
// silently — that is how the standard came to have twelve patterns and the code
// zero (BI-40B36B94). These tests parse FPAW §10 and fail in BOTH directions:
// a term added to the standard and not here, or a term here that the standard
// does not contain. The standard stays the source of truth; this module stays
// the only place the code spells the terms.

const STANDARD_PATH = join(
  __dirname,
  "../../../docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md",
);

function section10(): string {
  const text = readFileSync(STANDARD_PATH, "utf8");
  // Anchor on the real heading, not the table-of-contents entry that
  // repeats the same words earlier in the file.
  const start = text.indexOf("\n## 10. Performer and work-allocation model");
  expect(start, "FPAW §10 heading not found — the standard was restructured").toBeGreaterThan(-1);
  const end = text.indexOf("\n## 11.", start);
  return text.slice(start, end > -1 ? end : undefined);
}

/** The §10.3 allocation-pattern table, which alone fixes the gradient order. */
function patternTable(): string {
  const body = section10();
  const start = body.indexOf("### 10.3");
  return body.slice(start, body.indexOf("### 10.4", start));
}

/**
 * Collapse newlines and runs of spaces. The standard hard-wraps its prose, so
 * "data clearance" is literally "data\n   clearance" in the file and a naive
 * substring match misses a gate that is plainly there.
 */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

/** Backtick-quoted terms inside a slice, in document order, de-duplicated. */
function quotedTermsInOrder(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(/`([a-z][a-z0-9-]{2,})`/g)) {
    const term = match[1];
    if (!seen.has(term)) {
      seen.add(term);
      out.push(term);
    }
  }
  return out;
}

describe("FPAW §10 conformance", () => {
  it("declares every performer kind the standard requires", () => {
    const body = section10();
    for (const kind of PERFORMER_KINDS) {
      expect(body, `performer kind "${kind}" is not in FPAW §10`).toContain(`\`${kind}\``);
    }
  });

  it("declares every allocation pattern the standard requires", () => {
    const body = section10();
    for (const pattern of ALLOCATION_PATTERNS) {
      expect(body, `allocation pattern "${pattern}" is not in FPAW §10`).toContain(`\`${pattern}\``);
    }
  });

  it("misses no allocation pattern the standard adds later (drift, the other direction)", () => {
    // Every row of the §10.3 table names its pattern in the leading cell.
    const table = patternTable();
    const rowPatterns = [...table.matchAll(/^\|\s*`([a-z][a-z0-9-]+)`\s*\|/gm)].map((m) => m[1]);

    expect(rowPatterns.length, "parsed no rows from the §10.3 table").toBeGreaterThan(0);
    expect([...ALLOCATION_PATTERNS].sort()).toEqual([...rowPatterns].sort());
  });

  it("keeps the human-to-AI gradient in the order the standard sets", () => {
    // Order is measured inside the §10.3 table ONLY. "deterministic-automation"
    // is both a performer kind (§10.1) and an allocation pattern (§10.3), so a
    // whole-section scan meets it first and the gradient reads as broken when
    // it is not.
    const order = quotedTermsInOrder(patternTable()).filter((t) => isAllocationPattern(t));
    expect(order).toEqual([...ALLOCATION_PATTERNS]);
  });

  it("names every eligibility gate in §10.2", () => {
    // The gates are prose, not backticked, so match on the words the standard uses.
    const body = section10();
    const gateStart = body.indexOf("### 10.2");
    const step1 = flatten(body.slice(gateStart, body.indexOf("### 10.3", gateStart)));
    const PROSE: Record<string, string> = {
      authority: "authority",
      "license-credential": "license/credential",
      safety: "safety",
      "physical-reach": "physical reach",
      "data-clearance": "data clearance",
      "tool-resource-availability": "tool/resource availability",
      qualification: "qualification",
      "contractual-legal": "contractual and legal",
    };
    for (const gate of ELIGIBILITY_GATES) {
      expect(step1, `eligibility gate "${gate}" not found in §10.2`).toContain(PROSE[gate]);
    }
  });

  it("preserves the MUST NOT that makes eligibility a gate and not a score", () => {
    // If this sentence ever leaves the standard, the predicate below is no
    // longer grounded and this module must be re-derived, not quietly kept.
    // The standard bolds the modal: "**MUST NOT** become eligible ...".
    expect(section10()).toContain("become eligible merely because it is faster");
  });
});

describe("allowsAiExecution", () => {
  it("is true only where the standard lets AI execute the work", () => {
    const executing = ALLOCATION_PATTERNS.filter(allowsAiExecution);
    expect(executing).toEqual([
      "ai-led-human-approved",
      "ai-primary-human-exception",
      "bounded-autonomous-ai",
    ]);
  });

  it("does not treat ai-prepare-human-decide as AI execution", () => {
    // The AI prepares; an authorized human decides. Collapsing "AI is involved"
    // into "AI executes" is exactly the misreading this guards.
    expect(allowsAiExecution("ai-prepare-human-decide")).toBe(false);
  });

  it("does not treat human-led-ai-assisted as AI execution", () => {
    expect(allowsAiExecution("human-led-ai-assisted")).toBe(false);
  });
});

describe("requiresHumanInControlPath", () => {
  it("holds for human-only work", () => {
    expect(requiresHumanInControlPath("human-only")).toBe(true);
  });

  it("holds for every AI-executing pattern except the bounded-autonomous one", () => {
    expect(requiresHumanInControlPath("ai-led-human-approved")).toBe(true);
    expect(requiresHumanInControlPath("ai-primary-human-exception")).toBe(true);
    expect(requiresHumanInControlPath("bounded-autonomous-ai")).toBe(false);
  });

  it("holds for robot work — the safety supervisor is the human in the path", () => {
    expect(requiresHumanInControlPath("robot-primary-safety-supervised")).toBe(true);
  });
});

describe("narrowing guards", () => {
  it("accepts declared values and rejects everything else", () => {
    expect(isPerformerKind("authorized-robot")).toBe(true);
    expect(isAllocationPattern("bounded-autonomous-ai")).toBe(true);

    for (const bad of [null, undefined, 42, "", "robot", "ai", "AI-COWORKER", {}]) {
      expect(isPerformerKind(bad)).toBe(false);
      expect(isAllocationPattern(bad as AllocationPattern)).toBe(false);
    }
  });
});
