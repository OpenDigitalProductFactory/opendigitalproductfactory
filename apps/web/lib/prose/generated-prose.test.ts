import { describe, it, expect } from "vitest";
import {
  analyzeGeneratedProse,
  classifyGeneratedProse,
  LONG_SENTENCE_RATIO_BASELINE,
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

  it("keeps long sentences out of the TELL count but lets them set the zone", () => {
    // BI-41F15FD7, corrected against the corpus. Long sentences are not word-list
    // tells, but sentence length is the readability problem this corpus actually
    // has: 64% of real messages contain one, and 19.2% of all sentences are long.
    const long = `${"word ".repeat(40)}end.`;
    const reading = analyzeGeneratedProse(long);

    expect(reading.longSentences).toBe(1);
    expect(reading.tells).toBe(0);
    expect(reading.longSentenceRatio).toBe(1);
    expect(reading.zone).toBe("noticeable");
  });

  it("does not flag prose at or under the measured p90 long-sentence ratio", () => {
    // Baseline is p90, not the median, on purpose: at the median half the corpus
    // would flag every day, which is a number nobody reads.
    const short = "Short one. Another short one. A third short one.";
    const reading = analyzeGeneratedProse(short);

    expect(reading.longSentenceRatio).toBeLessThanOrEqual(LONG_SENTENCE_RATIO_BASELINE);
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

  it("treats the two signals independently", () => {
    // A word-list tell is rare and specific; a high long-sentence ratio is
    // common and diffuse. Either can raise the zone on its own.
    expect(classifyGeneratedProse(0, 10, 0.9)).toBe("noticeable");
    expect(classifyGeneratedProse(1, 10, 0)).toBe("noticeable");
    expect(classifyGeneratedProse(0, 10, 0.1)).toBe("clean");
  });
});
