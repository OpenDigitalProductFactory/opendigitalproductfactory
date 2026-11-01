import { describe, expect, it } from "vitest";
import { ATLAS_HEALTH_STATES, classifyAtlasHealth, type AtlasHealthFacts } from "./atlas-health";

const none: AtlasHealthFacts = {
  needsPerson: false, held: false, finished: false, noSignal: false, waiting: false, working: false,
};

describe("atlas health", () => {
  it("has exactly the six states the Work Atlas design names", () => {
    expect(ATLAS_HEALTH_STATES).toEqual(["needs-person", "stuck", "working", "waiting", "no-signal", "finished"]);
  });

  it("puts a decision a person owes ahead of every other signal", () => {
    expect(classifyAtlasHealth({ ...none, needsPerson: true, held: true, working: true })).toBe("needs-person");
  });

  it("puts a hold ahead of completion, silence and progress", () => {
    expect(classifyAtlasHealth({ ...none, held: true, finished: true, noSignal: true, working: true })).toBe("stuck");
  });

  it("treats finished work as finished even when stale progress signals remain", () => {
    expect(classifyAtlasHealth({ ...none, finished: true, working: true, waiting: true })).toBe("finished");
  });

  it("does not let silence pass as waiting or working", () => {
    expect(classifyAtlasHealth({ ...none, noSignal: true, waiting: true, working: true })).toBe("no-signal");
  });

  it("prefers waiting over working when both are reported", () => {
    expect(classifyAtlasHealth({ ...none, waiting: true, working: true })).toBe("waiting");
  });

  it("reads a room with no facts as waiting its turn, never as working", () => {
    expect(classifyAtlasHealth(none)).toBe("waiting");
  });

  it("returns exactly one state for every combination of facts", () => {
    const keys = Object.keys(none) as Array<keyof AtlasHealthFacts>;
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const facts = Object.fromEntries(keys.map((key, i) => [key, Boolean(mask & (1 << i))])) as AtlasHealthFacts;
      expect(ATLAS_HEALTH_STATES).toContain(classifyAtlasHealth(facts));
    }
  });
});
