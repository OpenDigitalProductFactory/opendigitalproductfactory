import { describe, expect, it } from "vitest";

import {
  OBLIGATION_TRIGGER_CLASSES,
  cadenceToDays,
  classifyObligationFrequency,
} from "./obligation-cadence";

describe("the four values the seeded packs actually write", () => {
  // These are not hypotheticals: across the seven compliance packs the column
  // holds exactly annual (27), monthly (7), continuous (46), event-driven (42).
  it("treats annual and monthly as real recurrences that need an anchor date", () => {
    for (const [word, days] of [["annual", 365], ["monthly", 30]] as const) {
      const c = classifyObligationFrequency(word);
      expect(c.triggerClass).toBe("cadence");
      expect(c.periodDays).toBe(days);
      expect(c.requiresAnchorDate).toBe(true);
    }
  });

  it("treats continuous as a standing control that is CORRECTLY dateless", () => {
    const c = classifyObligationFrequency("continuous");
    expect(c.triggerClass).toBe("continuous");
    expect(c.requiresAnchorDate).toBe(false);
    expect(c.periodDays).toBeNull();
  });

  it("treats event-driven as occurrence-started and CORRECTLY dateless", () => {
    const c = classifyObligationFrequency("event-driven");
    expect(c.triggerClass).toBe("event-driven");
    expect(c.requiresAnchorDate).toBe(false);
  });
});

describe("classification hygiene", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(classifyObligationFrequency("  Quarterly ").periodDays).toBe(91);
    expect(classifyObligationFrequency("CONTINUOUS").triggerClass).toBe("continuous");
  });

  it("never guesses a period from words it does not recognise", () => {
    const c = classifyObligationFrequency("when the auditor asks");
    expect(c.triggerClass).toBe("unrecognised");
    expect(c.periodDays).toBeNull();
    // Crucially it does NOT demand a date — a fabricated due date in front of a
    // compliance owner is worse than a missing one.
    expect(c.requiresAnchorDate).toBe(false);
  });

  it("separates 'no frequency recorded' from 'frequency nobody can compute'", () => {
    expect(classifyObligationFrequency(null).triggerClass).toBe("unspecified");
    expect(classifyObligationFrequency("   ").triggerClass).toBe("unspecified");
    expect(classifyObligationFrequency("sporadically").triggerClass).toBe("unrecognised");
  });

  it("lands every input in exactly one declared class", () => {
    for (const input of ["annual", "continuous", "event-driven", "gibberish", null, "", "weekly"]) {
      expect(OBLIGATION_TRIGGER_CLASSES).toContain(classifyObligationFrequency(input).triggerClass);
    }
  });

  it("only ever asks for a date on the cadence class", () => {
    for (const input of ["continuous", "event-driven", "gibberish", null, ""]) {
      expect(classifyObligationFrequency(input).requiresAnchorDate).toBe(false);
    }
  });

  it("keeps cadenceToDays agreeing with the classifier", () => {
    expect(cadenceToDays("quarterly")).toBe(91);
    expect(cadenceToDays("continuous")).toBeNull();
    expect(cadenceToDays("event-driven")).toBeNull();
  });
});
