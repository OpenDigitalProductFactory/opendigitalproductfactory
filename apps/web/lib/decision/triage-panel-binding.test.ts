import { describe, expect, it } from "vitest";

import { buildPanelBrief, parseVerdictText } from "./triage-panel-binding";
import { planTriageStaffing } from "./triage-staffing";
import type { TriageSubject } from "./triage-conductor";

const SUBJECT: TriageSubject = {
  interactionRowId: "row-1",
  interactionId: "DI-1",
  profileId: "p",
  question: "Do we ingest a third-party catalog without a signed DPA?",
  domainClass: "risk-assessment",
  gateKey: "org-business",
  riskTier: "medium",
  outcomeType: "escalate",
  resolved: false,
};

describe("parseVerdictText", () => {
  it("reads a bare JSON object", () => {
    expect(parseVerdictText('{"recommendedAction":"no_change"}')).toEqual({
      recommendedAction: "no_change",
    });
  });

  it("reads one inside a fenced block, prose and all", () => {
    const text = 'Here is the verdict.\n```json\n{"recommendedAction":"answer_gap"}\n```\nThanks.';
    expect(parseVerdictText(text)).toEqual({ recommendedAction: "answer_gap" });
  });

  it("returns null rather than a partial reading of something unparseable", () => {
    for (const text of [
      null,
      undefined,
      "",
      "   ",
      "I recommend declining the ingest.",
      "{not: valid json,",
      "[1, 2, 3]",
    ]) {
      expect(parseVerdictText(text)).toBeNull();
    }
  });

  it("never returns a bare array as a verdict", () => {
    expect(parseVerdictText('["answer_gap"]')).toBeNull();
  });
});

describe("buildPanelBrief", () => {
  it("tells the panel which professions are seated", () => {
    const plan = planTriageStaffing({
      domainClass: SUBJECT.domainClass,
      gateKey: SUBJECT.gateKey,
      question: SUBJECT.question,
    });
    const brief = buildPanelBrief({ subject: SUBJECT, plan, optionIds: ["proceed", "decline"] });
    expect(brief).toContain("Professions seated:");
    expect(brief).toContain("proceed, decline");
    expect(brief).toContain("recommendedAction");
  });

  it("tells the panel plainly when no profession applied, instead of leaving it to infer expertise", () => {
    const plan = planTriageStaffing({
      domainClass: "kernel-consult",
      gateKey: null,
      question: "Should we do the thing?",
    });
    const brief = buildPanelBrief({ subject: SUBJECT, plan, optionIds: [] });
    expect(brief).toContain("no profession applied");
    expect(brief).toContain("none recorded");
  });
});
