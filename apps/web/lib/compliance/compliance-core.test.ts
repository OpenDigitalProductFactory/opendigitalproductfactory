import { describe, expect, it } from "vitest";
import {
  regulationCreateFields, regulationUpdateFields,
  obligationCreateFields, obligationUpdateFields,
  controlCreateFields, controlUpdateFields,
  riskAssessmentCreateFields, riskAssessmentUpdateFields,
  incidentCreateFields, incidentUpdateFields,
  correctiveActionCreateFields, correctiveActionUpdateFields,
  auditCreateFields, auditUpdateFields,
  auditFindingCreateFields, auditFindingUpdateFields,
  evidenceCreateFields, submissionCreateFields, submissionUpdateFields,
  mapRegulationSummaries,
} from "./compliance-core";

describe("regulationCreateFields", () => {
  it("trims name/shortName/jurisdiction and applies defaults", () => {
    const out = regulationCreateFields({ name: "  GDPR  ", shortName: " GDPR ", jurisdiction: " EU " });
    expect(out.name).toBe("GDPR");
    expect(out.shortName).toBe("GDPR");
    expect(out.jurisdiction).toBe("EU");
    expect(out.sourceType).toBe("external"); // default
    expect(out.industry).toBeNull();
    expect(out.notes).toBeNull();
    expect(out.regulationId).toMatch(/^REG-[0-9A-F]{8}$/);
  });

  it("honors provided optional fields and sourceType override", () => {
    const eff = new Date("2026-01-01");
    const out = regulationCreateFields({
      name: "X", shortName: "X", jurisdiction: "US",
      industry: "finance", sourceType: "standard", effectiveDate: eff, sourceUrl: "http://x", notes: "n",
    });
    expect(out.industry).toBe("finance");
    expect(out.sourceType).toBe("standard");
    expect(out.effectiveDate).toBe(eff);
    expect(out.sourceUrl).toBe("http://x");
    expect(out.notes).toBe("n");
  });

  it("never emits an applicability key (JSON cast stays at call site)", () => {
    const out = regulationCreateFields({ name: "X", shortName: "X", jurisdiction: "US" });
    expect("applicability" in out).toBe(false);
  });
});

describe("regulationUpdateFields", () => {
  it("includes only provided keys and trims strings", () => {
    expect(regulationUpdateFields({ name: "  A  " })).toEqual({ name: "A" });
    expect(regulationUpdateFields({})).toEqual({});
  });

  it("passes through null values explicitly set", () => {
    expect(regulationUpdateFields({ industry: null })).toEqual({ industry: null });
  });

  it("omits applicability (handled at call site)", () => {
    const out = regulationUpdateFields({ name: "A" });
    expect("applicability" in out).toBe(false);
  });
});

describe("obligationCreateFields", () => {
  it("maps and defaults, generating an OBL id", () => {
    const out = obligationCreateFields({ title: "  T  ", regulationId: "reg-1" });
    expect(out.title).toBe("T");
    expect(out.regulationId).toBe("reg-1");
    expect(out.category).toBeNull();
    expect(out.applicability).toBeNull();
    expect(out.obligationId).toMatch(/^OBL-[0-9A-F]{8}$/);
  });
});

describe("obligationUpdateFields", () => {
  it("includes only provided keys", () => {
    expect(obligationUpdateFields({ title: " T " })).toEqual({ title: "T" });
    expect(obligationUpdateFields({ category: "safety" })).toEqual({ category: "safety" });
    expect(obligationUpdateFields({})).toEqual({});
  });
});

describe("controlCreateFields", () => {
  it("defaults implementationStatus to planned", () => {
    const out = controlCreateFields({ title: " C ", controlType: "preventive" });
    expect(out.title).toBe("C");
    expect(out.controlType).toBe("preventive");
    expect(out.implementationStatus).toBe("planned");
    expect(out.controlId).toMatch(/^CTL-[0-9A-F]{8}$/);
  });
  it("honors provided implementationStatus", () => {
    expect(controlCreateFields({ title: "C", controlType: "detective", implementationStatus: "implemented" }).implementationStatus).toBe("implemented");
  });
});

describe("controlUpdateFields", () => {
  it("includes only provided keys and trims title", () => {
    expect(controlUpdateFields({ title: " C " })).toEqual({ title: "C" });
    expect(controlUpdateFields({})).toEqual({});
  });
});

describe("riskAssessmentCreateFields", () => {
  it("falls back to the session employeeId when assessedBy not given", () => {
    const out = riskAssessmentCreateFields(
      { title: " R ", hazard: " H ", likelihood: "likely", severity: "major", inherentRisk: "high" },
      "emp-1",
    );
    expect(out.title).toBe("R");
    expect(out.hazard).toBe("H");
    expect(out.assessedByEmployeeId).toBe("emp-1");
    expect(out.assessmentId).toMatch(/^RA-[0-9A-F]{8}$/);
  });
  it("prefers an explicit assessedByEmployeeId over the session id", () => {
    const out = riskAssessmentCreateFields(
      { title: "R", hazard: "H", likelihood: "rare", severity: "minor", inherentRisk: "low", assessedByEmployeeId: "emp-2" },
      "emp-1",
    );
    expect(out.assessedByEmployeeId).toBe("emp-2");
  });
});

describe("riskAssessmentUpdateFields", () => {
  it("includes only provided keys, trimming title/hazard", () => {
    expect(riskAssessmentUpdateFields({ title: " R ", hazard: " H " })).toEqual({ title: "R", hazard: "H" });
    expect(riskAssessmentUpdateFields({})).toEqual({});
  });
});

describe("incidentCreateFields", () => {
  it("maps fields, defaults regulatoryNotifiable false, falls back reportedBy", () => {
    const occurredAt = new Date("2026-03-01");
    const out = incidentCreateFields({ title: " I ", occurredAt, severity: "high" }, "emp-9");
    expect(out.title).toBe("I");
    expect(out.occurredAt).toBe(occurredAt);
    expect(out.regulatoryNotifiable).toBe(false);
    expect(out.reportedByEmployeeId).toBe("emp-9");
    expect(out.incidentId).toMatch(/^INC-[0-9A-F]{8}$/);
  });
});

describe("incidentUpdateFields", () => {
  it("includes notifiedAt only when provided", () => {
    const d = new Date();
    expect(incidentUpdateFields({ notifiedAt: d })).toEqual({ notifiedAt: d });
    expect(incidentUpdateFields({})).toEqual({});
    // occurredAt is NOT an updatable field in the original action shape
    expect("occurredAt" in incidentUpdateFields({ title: "x" })).toBe(false);
  });
});

describe("correctiveActionCreateFields", () => {
  it("falls back owner to session employeeId and generates CA id", () => {
    const out = correctiveActionCreateFields({ title: " A ", sourceType: "incident" }, "emp-3");
    expect(out.title).toBe("A");
    expect(out.sourceType).toBe("incident");
    expect(out.ownerEmployeeId).toBe("emp-3");
    expect(out.actionId).toMatch(/^CA-[0-9A-F]{8}$/);
  });
});

describe("correctiveActionUpdateFields", () => {
  it("includes status/completedAt only when provided", () => {
    expect(correctiveActionUpdateFields({ status: "verified" })).toEqual({ status: "verified" });
    expect(correctiveActionUpdateFields({})).toEqual({});
  });
});

describe("auditCreateFields", () => {
  it("maps + defaults nulls and generates AUD id", () => {
    const out = auditCreateFields({ title: " Au ", auditType: "internal" });
    expect(out.title).toBe("Au");
    expect(out.auditorEmployeeId).toBeNull();
    expect(out.auditId).toMatch(/^AUD-[0-9A-F]{8}$/);
  });
});

describe("auditUpdateFields", () => {
  it("includes only provided keys incl. overallRating", () => {
    expect(auditUpdateFields({ overallRating: "conforming" })).toEqual({ overallRating: "conforming" });
    expect(auditUpdateFields({})).toEqual({});
  });
});

describe("auditFindingCreateFields", () => {
  it("carries the auditId param and generates FND id", () => {
    const out = auditFindingCreateFields("aud-1", { title: " F ", findingType: "observation" });
    expect(out.auditId).toBe("aud-1");
    expect(out.title).toBe("F");
    expect(out.findingId).toMatch(/^FND-[0-9A-F]{8}$/);
  });
});

describe("auditFindingUpdateFields", () => {
  it("includes resolvedAt only when provided", () => {
    const d = new Date();
    expect(auditFindingUpdateFields({ resolvedAt: d })).toEqual({ resolvedAt: d });
    expect(auditFindingUpdateFields({})).toEqual({});
  });
});

describe("evidenceCreateFields", () => {
  it("falls back collectedBy to session employeeId and generates EVD id", () => {
    const out = evidenceCreateFields({ title: " E ", evidenceType: "policy" }, "emp-7");
    expect(out.title).toBe("E");
    expect(out.evidenceType).toBe("policy");
    expect(out.collectedByEmployeeId).toBe("emp-7");
    expect(out.evidenceId).toMatch(/^EVD-[0-9A-F]{8}$/);
  });
  it("prefers explicit collectedByEmployeeId", () => {
    expect(evidenceCreateFields({ title: "E", evidenceType: "policy", collectedByEmployeeId: "emp-x" }, "emp-7").collectedByEmployeeId).toBe("emp-x");
  });
});

describe("submissionCreateFields", () => {
  it("trims title + recipientBody, falls back submittedBy, generates SUB id", () => {
    const out = submissionCreateFields({ title: " S ", recipientBody: " Reg Body ", submissionType: "annual-report" }, "emp-5");
    expect(out.title).toBe("S");
    expect(out.recipientBody).toBe("Reg Body");
    expect(out.submittedByEmployeeId).toBe("emp-5");
    expect(out.submissionId).toMatch(/^SUB-[0-9A-F]{8}$/);
  });
});

describe("submissionUpdateFields", () => {
  it("includes only provided keys, trimming title/recipientBody", () => {
    expect(submissionUpdateFields({ title: " S ", recipientBody: " R " })).toEqual({ title: "S", recipientBody: "R" });
    expect(submissionUpdateFields({ responseReceived: true })).toEqual({ responseReceived: true });
    expect(submissionUpdateFields({})).toEqual({});
  });
});

describe("mapRegulationSummaries", () => {
  it("projects rows into the dashboard summary shape", () => {
    const out = mapRegulationSummaries([
      { id: "r1", shortName: "GDPR", jurisdiction: "EU", _count: { obligations: 3 } },
      { id: "r2", shortName: "HIPAA", jurisdiction: "US", _count: { obligations: 0 } },
    ]);
    expect(out).toEqual([
      { id: "r1", shortName: "GDPR", jurisdiction: "EU", obligationCount: 3 },
      { id: "r2", shortName: "HIPAA", jurisdiction: "US", obligationCount: 0 },
    ]);
  });
  it("returns an empty array for no rows", () => {
    expect(mapRegulationSummaries([])).toEqual([]);
  });
});
