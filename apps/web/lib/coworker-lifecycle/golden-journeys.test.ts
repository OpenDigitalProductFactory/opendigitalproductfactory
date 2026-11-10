import { describe, expect, it } from "vitest";
import { COWORKER_AGENT_SEEDS } from "@dpf/db/workforce-seed";
import { CURATED_JOURNEYS, derivedReadProbe, journeysForCoworker } from "./golden-journeys";

describe("golden journeys (EP-COWORKER-LIFECYCLE Phase 2)", () => {
  it("every roster coworker gets at least one journey with zero authoring", () => {
    for (const seed of COWORKER_AGENT_SEEDS) {
      const journeys = journeysForCoworker(seed.agentId);
      expect(journeys.length).toBeGreaterThan(0);
      for (const journey of journeys) {
        expect(journey.agentId).toBe(seed.agentId);
        expect(journey.journeyId.startsWith(`${seed.agentId}/`)).toBe(true);
      }
    }
  });

  it("curated journeys replace the derived probe", () => {
    const journeys = journeysForCoworker("marketing-specialist");
    expect(journeys.every((j) => j.kind === "curated")).toBe(true);
    expect(journeys.map((j) => j.journeyId)).not.toContain(
      derivedReadProbe("marketing-specialist").journeyId,
    );
  });

  it("certifies the Change Reviewer with an evidence-grounded read-only code review", () => {
    const [journey] = journeysForCoworker("change-reviewer");

    expect(journey?.kind).toBe("curated");
    expect(journey?.mode).toBe("act");
    expect(journey?.prompt).toContain("read-only");
    expect(journey?.prompt).toContain("evidence");
    expect(journey?.prompt).toContain("Do not create, modify, or delete");
  });

  it("certifies the Time-off Advisor on a read-only workforce fact", () => {
    const [journey] = journeysForCoworker("time-off-advisor");
    expect(journey?.kind).toBe("curated");
    expect(journey?.prompt).toContain("query_employees");
    expect(journey?.prompt).toContain("Do not create, modify, or delete");
  });

  it("a coworker without curated journeys falls back to the derived probe", () => {
    // Deliberately a NON-roster id. This test names the fallback MECHANISM, and
    // pinning it to a real coworker made it hostage to curation coverage: it
    // began failing the moment that coworker was curated, which is the opposite
    // of what it exists to catch. Every roster coworker now has a curated
    // journey, so no real id can stand in for "uncurated".
    const journeys = journeysForCoworker("not-a-seeded-coworker");
    expect(journeys).toEqual([derivedReadProbe("not-a-seeded-coworker")]);
    expect(journeys[0].kind).toBe("derived");
  });

  it("all journeys are read-only by instruction", () => {
    const allJourneys = [
      ...COWORKER_AGENT_SEEDS.flatMap((seed) => journeysForCoworker(seed.agentId)),
    ];
    for (const journey of allJourneys) {
      expect(journey.prompt.toLowerCase()).toContain("do not create");
    }
  });

  it("curated journey ids are namespaced to their coworker", () => {
    for (const [agentId, journeys] of Object.entries(CURATED_JOURNEYS)) {
      for (const journey of journeys) {
        expect(journey.journeyId.startsWith(`${agentId}/`)).toBe(true);
      }
    }
  });

  it("curated coworkers exist in the roster (no ghost journeys)", () => {
    const rosterIds = new Set(COWORKER_AGENT_SEEDS.map((seed) => seed.agentId));
    for (const agentId of Object.keys(CURATED_JOURNEYS)) {
      expect(rosterIds.has(agentId), `${agentId} is not a roster coworker`).toBe(true);
    }
  });
});
