import { describe, expect, it } from "vitest";
import {
  mergeWorkPatternMetadata,
  normalizePatternText,
  parseWorkPatternMetadata,
  patternDecisionScope,
  workPatternFingerprint,
} from "./work-pattern-types";

describe("work pattern metadata helpers", () => {
  it("parses governed metadata from TaskRun JSON envelopes", () => {
    const metadata = parseWorkPatternMetadata({
      patternKey: "need:agent-a:route:tool:better-search",
      status: "candidate",
      scope: "route",
      version: 1,
      source: "observer",
      evidence: [{ taskRunId: "run-1", toolExecutionId: "tool-1" }],
      candidate: {
        kind: "tool",
        need: "Needs a better search affordance",
        blocks: "Cannot inspect prior specs reliably",
        fingerprint: "agent-a|route|tool|needs a better search affordance",
      },
    });

    expect(metadata).toMatchObject({
      patternKey: "need:agent-a:route:tool:better-search",
      status: "candidate",
      scope: "route",
      version: 1,
      source: "observer",
      decisionScope: "platform-wwmd",
      evidence: [{ taskRunId: "run-1", toolExecutionId: "tool-1" }],
      candidate: {
        kind: "tool",
        need: "Needs a better search affordance",
      },
    });
  });

  it("rejects invalid statuses, scopes, sources, and capability kinds", () => {
    expect(
      parseWorkPatternMetadata({
        patternKey: "bad-status",
        status: "shipping",
        scope: "route",
        version: 1,
        source: "observer",
      }),
    ).toBeNull();

    expect(
      parseWorkPatternMetadata({
        patternKey: "bad-kind",
        status: "candidate",
        scope: "route",
        version: 1,
        source: "observer",
        candidate: {
          kind: "vibe",
          need: "Needs vibes",
          blocks: "Hard to tell",
          fingerprint: "vibe",
        },
      }),
    ).toBeNull();
  });

  it("merges metadata under the workPattern key without erasing sibling payload", () => {
    const merged = mergeWorkPatternMetadata(
      { unrelated: { keep: true } },
      {
        patternKey: "case:handoff:missing-receipt",
        status: "observed",
        scope: "case-transition",
        version: 1,
        source: "human-review",
        decisionScope: "company-wwwd",
      },
    );

    expect(merged).toEqual({
      unrelated: { keep: true },
      workPattern: {
        patternKey: "case:handoff:missing-receipt",
        status: "observed",
        scope: "case-transition",
        version: 1,
        source: "human-review",
        decisionScope: "company-wwwd",
      },
    });
  });

  it("maps pattern scope to the commons layer that should own review", () => {
    expect(patternDecisionScope("case-type")).toBe("company-wwwd");
    expect(patternDecisionScope("case-transition")).toBe("company-wwwd");
    expect(patternDecisionScope("activity")).toBe("profession-wsid");
    expect(patternDecisionScope("risk-class")).toBe("profession-wsid");
    expect(patternDecisionScope("agent")).toBe("platform-wwmd");
    expect(patternDecisionScope("route")).toBe("platform-wwmd");
  });

  it("normalizes repeated need text into stable fingerprints", () => {
    expect(normalizePatternText("  Needs   better SEARCH. ")).toBe("needs better search");
    expect(
      workPatternFingerprint({
        agentId: "Agent A",
        routeContext: "/Storefront",
        kind: "tool",
        normalizedNeed: "Needs Better Search",
      }),
    ).toBe("agent a|/storefront|tool|needs better search");
  });
});
