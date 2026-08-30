// BI-C5D978E9 — a readiness refusal must reach the owner as words, not a digest.

import { describe, expect, it } from "vitest";

import { checkBuildPhaseInitiativeReadiness } from "./build-entry-gate";

const ARGS = { buildId: "FB-EB292B9F", currentPhase: "ideate", targetPhase: "plan" };

describe("checkBuildPhaseInitiativeReadiness", () => {
  // Live repro FB-EB292B9F: this refusal was thrown one line before the
  // phase-gate refusals #4761 converted, so production stripped it to a digest
  // and the owner saw "Minified React error #441" instead of the reason.
  it("returns the refusal message instead of throwing it", async () => {
    const message = "This cannot move into plan yet because the research behind this design has not been recorded (the design author).";
    const refusal = await checkBuildPhaseInitiativeReadiness(ARGS, async () => {
      throw new Error(message);
    });
    expect(refusal).toBe(message);
  });

  it("returns null when readiness allows the transition", async () => {
    expect(await checkBuildPhaseInitiativeReadiness(ARGS, async () => {})).toBeNull();
  });

  // A caller must always have something to show, even for a throw that carries
  // no message.
  it("falls back to a stated reason rather than an empty string", async () => {
    expect(await checkBuildPhaseInitiativeReadiness(ARGS, async () => { throw new Error(""); }))
      .toBe("Initiative readiness refused this transition.");
    expect(await checkBuildPhaseInitiativeReadiness(ARGS, async () => { throw "not an error"; }))
      .toBe("Initiative readiness refused this transition.");
  });
});
