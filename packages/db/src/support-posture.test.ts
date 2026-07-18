import { describe, expect, it } from "vitest";

import { deriveSupportPostureFromMilestones, type PostureMilestone } from "./support-posture";

const NOW = new Date("2026-07-17T00:00:00Z");

describe("deriveSupportPostureFromMilestones", () => {
  it("marks expired when the eol date is in the past", () => {
    const m: PostureMilestone[] = [{ milestone: "eol", date: "2024-01-01", source: "endoflife.date", confidence: 0.9 }];
    expect(deriveSupportPostureFromMilestones(m, NOW)).toEqual({
      supportStatus: "expired",
      supportLifecycleSource: "endoflife.date",
      supportLifecycleConfidence: 0.9,
    });
  });

  it("marks approaching_end within the 180-day window", () => {
    const m: PostureMilestone[] = [{ milestone: "eol", date: "2026-10-01", source: "endoflife.date", confidence: 0.9 }];
    expect(deriveSupportPostureFromMilestones(m, NOW)?.supportStatus).toBe("approaching_end");
  });

  it("marks supported when the eol date is far in the future", () => {
    const m: PostureMilestone[] = [{ milestone: "eol", date: "2030-01-01", source: "endoflife.date", confidence: 0.9 }];
    expect(deriveSupportPostureFromMilestones(m, NOW)?.supportStatus).toBe("supported");
  });

  it("returns null when there is no dated eol milestone (leaves the heuristic intact)", () => {
    expect(deriveSupportPostureFromMilestones([], NOW)).toBeNull();
    expect(
      deriveSupportPostureFromMilestones(
        [{ milestone: "end_of_sale", date: "2024-01-01", source: "wikidata", confidence: 0.4 }],
        NOW,
      ),
    ).toBeNull();
    expect(
      deriveSupportPostureFromMilestones([{ milestone: "eol", date: null, source: "endoflife.date", confidence: 0.9 }], NOW),
    ).toBeNull();
  });

  it("prefers the highest-confidence eol source when several disagree", () => {
    const m: PostureMilestone[] = [
      { milestone: "eol", date: "2024-01-01", source: "wikidata", confidence: 0.4 }, // past
      { milestone: "eol", date: "2030-01-01", source: "endoflife.date", confidence: 0.9 }, // future, higher conf
    ];
    const posture = deriveSupportPostureFromMilestones(m, NOW);
    expect(posture?.supportStatus).toBe("supported");
    expect(posture?.supportLifecycleSource).toBe("endoflife.date");
    expect(posture?.supportLifecycleConfidence).toBe(0.9);
  });

  it("accepts Date instances as well as strings", () => {
    const m: PostureMilestone[] = [{ milestone: "eol", date: new Date("2024-01-01"), source: "endoflife.date", confidence: 0.9 }];
    expect(deriveSupportPostureFromMilestones(m, NOW)?.supportStatus).toBe("expired");
  });

  it("prefers human-confirmed milestone precedence (confidence 1.0) over other sources", () => {
    const m: PostureMilestone[] = [
      { milestone: "eol", date: "2024-01-01", source: "human_confirmed", confidence: 1.0 },
      { milestone: "eol", date: "2030-01-01", source: "endoflife.date", confidence: 0.9 },
    ];
    const posture = deriveSupportPostureFromMilestones(m, NOW);
    expect(posture?.supportStatus).toBe("expired");
    expect(posture?.supportLifecycleSource).toBe("human_confirmed");
    expect(posture?.supportLifecycleConfidence).toBe(1.0);
  });
});
