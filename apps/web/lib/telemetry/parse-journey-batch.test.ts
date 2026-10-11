import { describe, expect, it } from "vitest";
import { parseJourneyBatch } from "./parse-journey-batch";
import { pathSection } from "./journey-vocabulary";

const SECTIONS = new Set(["workspace", "build"]);

describe("parseJourneyBatch (BI-BD0B0DCC AC-6)", () => {
  it("keeps valid journey and vital samples", () => {
    expect(
      parseJourneyBatch(
        {
          samples: [
            { kind: "journey", journey: "message-ack", totalMs: 180, serverMs: 40 },
            { kind: "vital", metric: "INP", value: 96, section: "workspace" },
            { kind: "vital", metric: "CLS", value: 0.04, section: "build" },
          ],
        },
        SECTIONS,
      ),
    ).toEqual([
      { kind: "journey", journey: "message-ack", totalMs: 180, serverMs: 40 },
      { kind: "vital", metric: "INP", value: 96, section: "workspace" },
      { kind: "vital", metric: "CLS", value: 0.04, section: "build" },
    ]);
  });

  it("drops unknown journeys and metrics instead of turning them into labels", () => {
    expect(
      parseJourneyBatch(
        {
          samples: [
            { kind: "journey", journey: "made-up", totalMs: 10 },
            { kind: "vital", metric: "FID", value: 10, section: "workspace" },
            { kind: "other" },
            null,
            "x",
          ],
        },
        SECTIONS,
      ),
    ).toEqual([]);
  });

  it("maps an unlisted section to other", () => {
    expect(parseJourneyBatch({ samples: [{ kind: "vital", metric: "LCP", value: 900, section: "evil-label-<x>" }] }, SECTIONS))
      .toEqual([{ kind: "vital", metric: "LCP", value: 900, section: "other" }]);
  });

  it("drops non-finite, negative and out-of-range values", () => {
    expect(
      parseJourneyBatch(
        {
          samples: [
            { kind: "journey", journey: "thread-open", totalMs: -1 },
            { kind: "journey", journey: "thread-open", totalMs: 120_001 },
            { kind: "journey", journey: "thread-open", totalMs: "5" },
            { kind: "vital", metric: "CLS", value: 11, section: "workspace" },
            { kind: "vital", metric: "TTFB", value: Number.NaN, section: "workspace" },
          ],
        },
        SECTIONS,
      ),
    ).toEqual([]);
  });

  it("drops a server share that is invalid or larger than the total, keeping the total", () => {
    expect(parseJourneyBatch({ samples: [{ kind: "journey", journey: "thread-open", totalMs: 50, serverMs: 80 }] }, SECTIONS))
      .toEqual([{ kind: "journey", journey: "thread-open", totalMs: 50 }]);
  });

  it("accepts at most 50 samples", () => {
    const samples = Array.from({ length: 80 }, () => ({ kind: "journey", journey: "shell-ready", totalMs: 1 }));
    expect(parseJourneyBatch({ samples }, SECTIONS)).toHaveLength(50);
  });

  it("returns nothing for a body without a samples array", () => {
    expect(parseJourneyBatch(null, SECTIONS)).toEqual([]);
    expect(parseJourneyBatch({ samples: "x" }, SECTIONS)).toEqual([]);
  });
});

describe("pathSection", () => {
  it("takes the first segment, lower-cased and bounded", () => {
    expect(pathSection("/workspace/inbox")).toBe("workspace");
    expect(pathSection("/")).toBe("root");
    expect(pathSection("/BUILD")).toBe("build");
    expect(pathSection(`/${"a".repeat(60)}`)).toHaveLength(40);
  });
});
