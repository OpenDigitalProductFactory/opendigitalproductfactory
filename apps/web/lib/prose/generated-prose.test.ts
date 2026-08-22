import { describe, it, expect } from "vitest";
import {
  analyzeGeneratedProse,
  classifyGeneratedProse,
} from "./generated-prose";

describe("analyzeGeneratedProse", () => {
  it("scores clean prose as clean", () => {
    const reading = analyzeGeneratedProse(
      "Every skill declared the same invocation triple, so the ranker had nothing to rank on. " +
        "34 skills now declare their real classification.",
    );

    expect(reading.tells).toBe(0);
    expect(reading.zone).toBe("clean");
  });

  it("counts puffery, superficial -ing clauses, and chatbot filler separately", () => {
    const reading = analyzeGeneratedProse(
      "This represents a pivotal, seamless upgrade, ensuring reliability. I hope this helps!",
    );

    expect(reading.puffery).toBe(2); // pivotal, seamless
    expect(reading.superficialIng).toBe(1); // ", ensuring"
    expect(reading.chatbotFiller).toBe(1); // "i hope this helps"
    expect(reading.tells).toBe(4);
  });

  it("counts every occurrence, not every matching phrase", () => {
    // Three "seamless" in one paragraph should read as three tells, not one.
    const reading = analyzeGeneratedProse("Seamless here, seamless there, seamless everywhere.");
    expect(reading.puffery).toBe(3);
  });

  it("does not flag participial clauses that carry a real fact", () => {
    // The closed list is the whole point: this clause asserts something
    // checkable, so it is not filler even though it matches ", <verb>ing".
    const reading = analyzeGeneratedProse(
      "The loader reads both planes, returning null when the row is absent.",
    );

    expect(reading.superficialIng).toBe(0);
    expect(reading.tells).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(analyzeGeneratedProse("A ROBUST, Cutting-Edge result.").puffery).toBe(2);
  });

  it("reports long sentences but keeps them out of the tell count", () => {
    // A long sentence can be the right sentence — surfaced, never scored.
    const long = `${"word ".repeat(40)}end.`;
    const reading = analyzeGeneratedProse(long);

    expect(reading.longSentences).toBe(1);
    expect(reading.tells).toBe(0);
    expect(reading.zone).toBe("clean");
  });

  it("handles empty and whitespace input without throwing", () => {
    for (const input of ["", "   ", "\n\n"]) {
      const reading = analyzeGeneratedProse(input);
      expect(reading.tells).toBe(0);
      expect(reading.sentences).toBe(0);
      expect(reading.zone).toBe("clean");
    }
  });
});

describe("classifyGeneratedProse", () => {
  it("bands by density so a long report is not punished for being long", () => {
    // Same three tells: dense in a short alert, diluted across a long report.
    expect(classifyGeneratedProse(3, 4)).toBe("slop");
    expect(classifyGeneratedProse(3, 40)).toBe("noticeable");
  });

  it("escalates on absolute count even when diluted", () => {
    expect(classifyGeneratedProse(6, 100)).toBe("slop");
  });

  it("never divides by zero on empty text", () => {
    expect(classifyGeneratedProse(0, 0)).toBe("clean");
    expect(classifyGeneratedProse(2, 0)).toBe("slop");
  });
});
