// The rule that decides whether a fix build may record its own diagnosis.
//
// Measured on this install: 14 of 16 abandoned fix builds had an incomplete
// fixContext, and "design repair escalated" is the largest single cause of build
// abandonment (14 of 45). Those builds escalate to a human at round 0 and, on an
// unattended install, are reaped at seven days.
//
// The safety property these tests exist to hold: a guess must never become the
// evidence the plan phase builds on. Refusal is the correct outcome when the
// investigation did not land.
import { describe, it, expect } from "vitest";
import {
  parseFixDiagnosis,
  isDiagnosisRefusal,
  buildFixDiagnosisPrompt,
} from "./fix-context-diagnosis";

const GOOD = {
  reproSteps: "Open /ops, click Start build on BI-9624B97B; the page crashes into the error boundary.",
  rootCause: "startBuildAction in apps/web/lib/actions/build-studio.ts throws when originator is null.",
  fixApproach: "Guard the null originator and surface a typed refusal; the happy path is unchanged.",
};

describe("fix-context self-diagnosis rule", () => {
  it("accepts a grounded diagnosis with all three fields", () => {
    const out = parseFixDiagnosis(GOOD);
    expect(isDiagnosisRefusal(out)).toBe(false);
    if (!isDiagnosisRefusal(out)) expect(out.rootCause).toContain("build-studio.ts");
  });

  it("accepts the same diagnosis wrapped in prose and fences", () => {
    const raw = "Here is what I found:\n```json\n" + JSON.stringify(GOOD) + "\n```\nHope that helps.";
    expect(isDiagnosisRefusal(parseFixDiagnosis(raw))).toBe(false);
  });

  it("REFUSES a partial diagnosis rather than writing two of three fields", () => {
    // isFixContextComplete needs all three, so a partial write would leave the
    // build failing the identical review while claiming progress.
    const out = parseFixDiagnosis({ ...GOOD, fixApproach: "" });
    expect(isDiagnosisRefusal(out)).toBe(true);
    if (isDiagnosisRefusal(out)) expect(out.reason).toContain("fixApproach");
  });

  it("REFUSES non-answers dressed as fields", () => {
    for (const filler of ["unknown", "TBD", "needs investigation", "unclear", "n/a"]) {
      const out = parseFixDiagnosis({ ...GOOD, rootCause: filler });
      expect(isDiagnosisRefusal(out), filler).toBe(true);
    }
  });

  it("REFUSES a field too short to have said anything", () => {
    expect(isDiagnosisRefusal(parseFixDiagnosis({ ...GOOD, reproSteps: "it breaks" }))).toBe(true);
  });

  it("keeps a substantive answer that merely mentions uncertainty", () => {
    // Real diagnoses carry caveats; only a bare non-answer is refused.
    const hedged = {
      ...GOOD,
      rootCause:
        "The null originator is unhandled in startBuildAction; it is unclear whether the seed or the promoter leaves it null, but the crash is the unguarded read.",
    };
    expect(isDiagnosisRefusal(parseFixDiagnosis(hedged))).toBe(false);
  });

  it("REFUSES unparseable, empty and wrong-shaped responses", () => {
    for (const bad of ["no json here", "{not json}", "", null, undefined, 42, ["a"], {}]) {
      expect(isDiagnosisRefusal(parseFixDiagnosis(bad)), String(bad)).toBe(true);
    }
  });

  it("tells the investigator that refusing is the preferred outcome over guessing", () => {
    const prompt = buildFixDiagnosisPrompt({ title: "T", problem: "P" });
    expect(prompt).toContain("A refused diagnosis is escalated to a human");
    expect(prompt).toMatch(/guess/i);
    // It must ask for grounding on the current tree, not recall.
    expect(prompt).toMatch(/current tree/);
  });

  it("carries the prior review issues so a retry is not a blind repeat", () => {
    const prompt = buildFixDiagnosisPrompt({
      title: "T",
      problem: "P",
      priorIssues: ["Reproduction steps are missing"],
    });
    expect(prompt).toContain("Reproduction steps are missing");
  });
});
