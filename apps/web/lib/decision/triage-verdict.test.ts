import { describe, expect, it } from "vitest";

import { admitTriageVerdict, panelReportedInsufficient } from "./triage-verdict";

const GOOD = {
  recommendedAction: "answer_gap",
  draft: { question: "Do we ingest third-party catalogs?", answer: "Not without a signed DPA." },
  summary: "Decline the ingest until a data agreement exists",
  consequences: [
    { optionId: "proceed", text: "Ingests today, and accepts the exposure until a DPA exists." },
    { optionId: "decline", text: "Delays the catalog, and keeps the obligation clean." },
  ],
  dissent: [],
  confidence: 0.8,
};

describe("admitTriageVerdict", () => {
  it("admits a complete verdict", () => {
    const result = admitTriageVerdict(GOOD);
    expect(result.admissible).toBe(true);
    if (!result.admissible) return;
    expect(result.verdict.recommendedAction).toBe("answer_gap");
    expect(result.verdict.consequences).toHaveLength(2);
  });

  it("refuses anything that is not a verdict at all", () => {
    for (const raw of [null, undefined, "sounds good to me", [], 42]) {
      const result = admitTriageVerdict(raw);
      expect(result.admissible).toBe(false);
      if (result.admissible) return;
      expect(result.rejection).toBe("no-verdict");
    }
  });

  it("refuses an action this platform does not have", () => {
    const result = admitTriageVerdict({ ...GOOD, recommendedAction: "delete_everything" });
    expect(result).toMatchObject({ admissible: false, rejection: "unknown-action" });
  });

  it("refuses an action whose write path is not wired, so nobody accepts a no-op", () => {
    for (const action of ["amend_stance", "release_material", "adjust_weight"]) {
      expect(admitTriageVerdict({ ...GOOD, recommendedAction: action })).toMatchObject({
        admissible: false,
        rejection: "unsupported-action",
      });
    }
  });

  it("refuses a recommendation with nothing drafted behind it", () => {
    expect(admitTriageVerdict({ ...GOOD, draft: {} })).toMatchObject({
      admissible: false,
      rejection: "missing-draft",
    });
    expect(admitTriageVerdict({ ...GOOD, draft: { answer: "   " } })).toMatchObject({
      admissible: false,
      rejection: "missing-draft",
    });
  });

  it("checks the draft field the ACTION needs, not just any field", () => {
    // An adopt-option verdict carrying answer text has not named an option.
    expect(
      admitTriageVerdict({ ...GOOD, recommendedAction: "adopt_option", draft: { answer: "yes" } }),
    ).toMatchObject({ admissible: false, rejection: "missing-draft" });
    expect(
      admitTriageVerdict({
        ...GOOD,
        recommendedAction: "adopt_option",
        draft: { optionId: "decline" },
      }).admissible,
    ).toBe(true);
  });

  it("refuses a draft with no statement of what it is", () => {
    expect(admitTriageVerdict({ ...GOOD, summary: "" })).toMatchObject({
      admissible: false,
      rejection: "missing-summary",
    });
  });

  it("refuses a verdict that never says what the options cost", () => {
    expect(admitTriageVerdict({ ...GOOD, consequences: [] })).toMatchObject({
      admissible: false,
      rejection: "missing-consequences",
    });
    expect(admitTriageVerdict({ ...GOOD, consequences: "proceed is fine" })).toMatchObject({
      admissible: false,
      rejection: "missing-consequences",
    });
    // Entries missing a half are dropped, and dropping them all is still empty.
    expect(admitTriageVerdict({ ...GOOD, consequences: [{ optionId: "proceed" }] })).toMatchObject({
      admissible: false,
      rejection: "missing-consequences",
    });
  });

  it("separates an empty dissent list from an absent one", () => {
    // Empty = they agreed. Admissible.
    expect(admitTriageVerdict({ ...GOOD, dissent: [] }).admissible).toBe(true);
    // Absent = nobody recorded it. Consensus must not be inferred.
    expect(admitTriageVerdict({ ...GOOD, dissent: undefined })).toMatchObject({
      admissible: false,
      rejection: "missing-dissent",
    });
  });

  it("keeps a dissenting voice and clamps confidence into range", () => {
    const result = admitTriageVerdict({
      ...GOOD,
      dissent: [{ role: "legal", position: "proceed", because: "the DPA is already on file" }],
      confidence: 4,
    });
    expect(result.admissible).toBe(true);
    if (!result.admissible) return;
    expect(result.verdict.dissent[0]!.role).toBe("legal");
    expect(result.verdict.confidence).toBe(1);
  });

  it("reads a missing confidence as unknown rather than as certainty", () => {
    const result = admitTriageVerdict({ ...GOOD, confidence: "very" });
    expect(result.admissible).toBe(true);
    if (!result.admissible) return;
    expect(result.verdict.confidence).toBeNull();
  });
});

describe("panelReportedInsufficient", () => {
  it("takes the run's own word for it when it could not ground a recommendation", () => {
    expect(panelReportedInsufficient("insufficient-evidence")).toBe(true);
    expect(panelReportedInsufficient("no-consensus")).toBe(true);
    expect(panelReportedInsufficient("consensus")).toBe(false);
    expect(panelReportedInsufficient("partial-consensus")).toBe(false);
    expect(panelReportedInsufficient(null)).toBe(false);
  });
});
