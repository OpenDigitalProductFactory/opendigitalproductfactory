import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OUTCOME_DISPOSITIONS } from "@/lib/shared/outcome-disposition";

// BI-77CFC7BF. A shape's stop conditions said whether it ended well, badly or
// out of budget — never what happens next. The authors wrote that in English
// inside `condition` because the type could not hold it. `disposition` is now
// REQUIRED, so the compiler enforces the classification; this file guards the
// two things a type cannot: that no site slipped through in a form the compiler
// accepts loosely, and that nobody later "simplifies" the field into a
// derivation of `kind`.
const DIR = fileURLToPath(new URL(".", import.meta.url));

// Brace-matched, not a flat regex: several conditions are multi-line string
// CONCATENATIONS, so the disposition sits after the `+ "..."` rather than
// immediately after the first quoted chunk. A flat regex reported 14 of these
// as unclassified when the compiler could see all 141 were fine — the test was
// wrong, not the data. (It also mangled them on the way in, once.)
const KIND = /\{\s*\n?\s*kind:\s*"(success|failure|budget)"\s*,/g;

function objectEnd(source: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) break;
        i += 1;
      }
    } else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced work-shape stop condition object");
}

function everyStopCondition(): Array<{ file: string; kind: string; disposition?: string }> {
  const out: Array<{ file: string; kind: string; disposition?: string }> = [];
  for (const file of readdirSync(DIR)) {
    // NB: the craft/operate shape files end "-craft.ts" / "-operate.ts", not
    // "-shapes.ts" — matching only the latter silently skipped 24 of them.
    if (!/shapes.*\.ts$/.test(file) || file.includes(".test.")) continue;
    const source = readFileSync(join(DIR, file), "utf8");
    for (const m of source.matchAll(KIND)) {
      const body = source.slice(m.index!, objectEnd(source, m.index!));
      const d = /disposition:\s*"([a-z-]+)"/.exec(body);
      out.push({ file, kind: m[1], ...(d ? { disposition: d[1] } : {}) });
    }
  }
  return out;
}

describe("work shapes declare how they stop (BI-77CFC7BF)", () => {
  const stops = everyStopCondition();

  it("finds every shape file's stop conditions", () => {
    // Guards the regex itself: if the literal shape changes, this test must not
    // silently start asserting nothing.
    expect(stops.length).toBeGreaterThanOrEqual(140);
  });

  it("classifies every stop condition, in every shape file", () => {
    const unclassified = stops.filter((s) => !s.disposition);
    expect(unclassified).toEqual([]);
    for (const stop of stops) {
      expect(OUTCOME_DISPOSITIONS).toContain(stop.disposition!);
    }
  });

  it("marks a successful stop as proceed", () => {
    for (const stop of stops.filter((s) => s.kind === "success")) {
      expect(stop.disposition).toBe("proceed");
    }
  });

  it("does not let `kind` stand in for the disposition", () => {
    // The reason the field exists. If kind determined disposition it would be
    // derivable and all of this would be redundant — so pin that it is not,
    // in BOTH directions.
    const byKind = (k: string) => new Set(stops.filter((s) => s.kind === k).map((s) => s.disposition));
    expect(byKind("failure").size).toBeGreaterThan(1);
    expect(byKind("budget").size).toBeGreaterThan(1);

    // A budget stop that is a settled no ("refused; the lane is WIP 1"), and
    // one the caller can act on ("the room stops for reshaping").
    expect(byKind("budget")).toContain("refused");
    expect(byKind("budget")).toContain("awaiting-input");
    // A "failure" that says "reshape to large" is not a refusal at all.
    expect(byKind("failure")).toContain("awaiting-input");
  });

  it("most `failure` exits are inconclusive, not refusals — the finding", () => {
    // 37 of 47 read "the substrate cannot be read — the run stops and reports",
    // which is AGENTS.md §4 fail-open-on-infrastructure. The shape files had
    // been carrying this epic's own thesis as prose. If this ratio ever
    // inverts, someone has started calling non-verdicts failures again.
    const failures = stops.filter((s) => s.kind === "failure");
    const inconclusive = failures.filter((s) => s.disposition === "inconclusive");
    expect(inconclusive.length).toBeGreaterThan(failures.length / 2);
  });
});
