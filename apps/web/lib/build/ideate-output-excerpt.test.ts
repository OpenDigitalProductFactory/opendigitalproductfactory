// apps/web/lib/build/ideate-output-excerpt.test.ts
//
// BI-7AD0759A — a local ideate run that cannot be parsed must keep what the
// model actually said. Live repro FB-D23311A7: the local model ran twice for
// ~4 minutes each, failed to parse, and its output was discarded — leaving a
// local-only install with no way to see why its build would not complete.

import { describe, expect, it } from "vitest";

import {
  describeIdeateOutput,
  excerptHeadAndTail,
  IDEATE_EXCERPT_BUDGET,
} from "./ideate-output-excerpt";

describe("excerptHeadAndTail", () => {
  it("returns short output whole", () => {
    const text = '{"problemStatement":"foster roster"}';
    expect(excerptHeadAndTail(text)).toBe(text);
  });

  it("keeps BOTH ends, because a malformed object usually dies at the tail", () => {
    const out = excerptHeadAndTail("H".repeat(2000) + "T".repeat(2000));

    expect(out.startsWith("H")).toBe(true);
    expect(out.endsWith("T")).toBe(true);
    expect(out).toContain("chars elided");
  });

  it("names how much was elided so an excerpt is never mistaken for the whole response", () => {
    expect(excerptHeadAndTail("x".repeat(IDEATE_EXCERPT_BUDGET + 500)))
      .toContain("[500 chars elided]");
  });

  it("stays within budget plus the elision marker", () => {
    expect(excerptHeadAndTail("y".repeat(50_000)).length)
      .toBeLessThan(IDEATE_EXCERPT_BUDGET + 100);
  });

  it("honours a caller-supplied budget", () => {
    expect(excerptHeadAndTail("z".repeat(400), 100).length).toBeLessThan(200);
  });
});

describe("describeIdeateOutput", () => {
  it("reports an empty response as its own diagnosis", () => {
    expect(describeIdeateOutput("")).toContain("no output at all");
    expect(describeIdeateOutput(undefined)).toContain("no output at all");
    expect(describeIdeateOutput("   ")).toContain("no output at all");
  });

  it("reports the length and the content when the model did answer", () => {
    const out = describeIdeateOutput("Here is a design, not JSON.");

    expect(out).toContain("27 chars");
    expect(out).toContain("Here is a design, not JSON.");
    expect(out).not.toContain("no output at all");
  });
});
