// What the coworker is actually asked to do (BI-4A394B21).

import { describe, expect, it } from "vitest";

import { STAGE_EVIDENCE_TOOL, buildStageBrief, type StageBriefInput } from "./stage-briefing";

const input: StageBriefInput = {
  capsuleId: "WC-A69BCABB",
  roomObjective: "Sweep published advisories against the recorded dependency manifest.",
  shapeKey: "dependency-advisory-watch",
  shapeVersion: "1.0.0",
  shapeTitle: "Dependency and advisory watch",
  shapeDescription: "The security engineer sweeps advisories. It never applies a patch.",
  stageKey: "sweep",
  stageTitle: "Sweep advisories against the manifest",
  doneWhen: "Every advisory source in scope has been read and correlated to the recorded manifest.",
  evidenceKinds: ["assurance-run"],
  stopConditions: ["The advisory source cannot be read."],
};

describe("buildStageBrief", () => {
  it("states the definition of done, which the old prompt omitted entirely", () => {
    // The old brief was the stage KEY and three prohibitions. 337 runs answered
    // it with prose and zero tool calls.
    expect(buildStageBrief(input)).toContain("read and correlated to the recorded manifest");
  });

  it("carries the room objective and the activity's own description", () => {
    const brief = buildStageBrief(input);
    expect(brief).toContain("Sweep published advisories");
    expect(brief).toContain("It never applies a patch.");
  });

  it("names the stage in words, not just a key", () => {
    expect(buildStageBrief(input)).toContain("Sweep advisories against the manifest");
  });

  it("tells the coworker to record evidence through the governed tool, with the stage", () => {
    const brief = buildStageBrief(input);
    expect(brief).toContain(STAGE_EVIDENCE_TOOL);
    expect(brief).toContain('stageKey "sweep"');
    expect(brief).toContain('"assurance-run"');
  });

  it("says plainly that claiming completion does not advance anything", () => {
    // The behaviour the platform now enforces; saying so is cheaper than
    // letting the coworker discover it by being re-dispatched.
    const brief = buildStageBrief(input);
    expect(brief).toContain("Saying the work is done does not advance it");
  });

  it("tells the coworker to report a blocker rather than fake success", () => {
    expect(buildStageBrief(input)).toContain("Do not report success for work you did not do.");
  });

  it("carries stop conditions so the run ends instead of grinding", () => {
    expect(buildStageBrief(input)).toContain("The advisory source cannot be read.");
  });

  it("keeps the original prohibitions", () => {
    expect(buildStageBrief(input)).toContain("Do not skip stages, widen authority, or invent occupants.");
  });

  it("degrades cleanly when the shape declares little", () => {
    const sparse = buildStageBrief({
      ...input,
      roomObjective: null,
      shapeTitle: null,
      shapeDescription: null,
      stageTitle: null,
      doneWhen: null,
      evidenceKinds: [],
      stopConditions: [],
    });
    expect(sparse).toContain("WC-A69BCABB");
    expect(sparse).toContain(STAGE_EVIDENCE_TOOL);
    expect(sparse).not.toContain("null");
  });
});
