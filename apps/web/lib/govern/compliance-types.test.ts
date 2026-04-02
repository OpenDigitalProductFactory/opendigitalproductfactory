// Pure utility tests — no server imports required.
import { describe, it, expect } from "vitest";
import {
  // ID generators
  generateRegulationId,
  generateObligationId,
  generateControlId,
  generateEvidenceId,
  generateIncidentId,
  generateActionId,
  generateAuditId,
  generateFindingId,
  generateSubmissionId,
  generateAssessmentId,
  // Constants
  REGULATION_STATUSES,
  REGULATION_SOURCE_TYPES,
  OBLIGATION_CATEGORIES,
  OBLIGATION_FREQUENCIES,
  CONTROL_TYPES,
  CONTROL_IMPLEMENTATION_STATUSES,
  CONTROL_EFFECTIVENESS,
  EVIDENCE_TYPES,
  RISK_LIKELIHOODS,
  RISK_SEVERITIES,
  RISK_LEVELS,
  INCIDENT_SEVERITIES,
  INCIDENT_CATEGORIES,
  INCIDENT_STATUSES,
  CORRECTIVE_ACTION_STATUSES,
  CORRECTIVE_ACTION_SOURCE_TYPES,
  AUDIT_TYPES,
  AUDIT_STATUSES,
  AUDIT_RATINGS,
  FINDING_TYPES,
  SUBMISSION_TYPES,
  SUBMISSION_STATUSES,
  // Validators
  validateRegulationInput,
  validateObligationInput,
  validateControlInput,
  // Input types (type-only imports)
  type RegulationInput,
  type ObligationInput,
  type ControlInput,
} from "./compliance-types";

// ─── ID Generator Tests ───────────────────────────────────────────────────────

const ID_PATTERN = (prefix: string) => new RegExp(`^${prefix}-[0-9A-F]{8}$`);

describe("ID generators", () => {
  const cases: Array<[string, () => string, string]> = [
    ["generateRegulationId", generateRegulationId, "REG"],
    ["generateObligationId", generateObligationId, "OBL"],
    ["generateControlId", generateControlId, "CTL"],
    ["generateEvidenceId", generateEvidenceId, "EVD"],
    ["generateIncidentId", generateIncidentId, "INC"],
    ["generateActionId", generateActionId, "CA"],
    ["generateAuditId", generateAuditId, "AUD"],
    ["generateFindingId", generateFindingId, "FND"],
    ["generateSubmissionId", generateSubmissionId, "SUB"],
    ["generateAssessmentId", generateAssessmentId, "RA"],
  ];

  for (const [name, fn, prefix] of cases) {
    it(`${name}() returns ${prefix}-XXXXXXXX format`, () => {
      const id = fn();
      expect(id).toMatch(ID_PATTERN(prefix));
    });

    it(`${name}() generates unique IDs`, () => {
      const ids = new Set(Array.from({ length: 20 }, () => fn()));
      expect(ids.size).toBe(20);
    });
  }
});

// ─── Constants Tests ──────────────────────────────────────────────────────────

describe("REGULATION_STATUSES", () => {
  it("contains expected values", () => {
    expect(REGULATION_STATUSES).toContain("active");
    expect(REGULATION_STATUSES).toContain("inactive");
    expect(REGULATION_STATUSES).toContain("superseded");
    expect(REGULATION_STATUSES).toHaveLength(3);
  });
});

describe("REGULATION_SOURCE_TYPES", () => {
  it("contains expected values", () => {
    expect(REGULATION_SOURCE_TYPES).toContain("external");
    expect(REGULATION_SOURCE_TYPES).toContain("standard");
    expect(REGULATION_SOURCE_TYPES).toContain("framework");
    expect(REGULATION_SOURCE_TYPES).toContain("internal");
    expect(REGULATION_SOURCE_TYPES).toHaveLength(4);
  });
});

describe("OBLIGATION_CATEGORIES", () => {
  it("contains expected values", () => {
    const expected = ["data-protection", "safety", "financial-reporting", "environmental", "cybersecurity", "employment", "operational", "other"];
    for (const v of expected) expect(OBLIGATION_CATEGORIES).toContain(v);
    expect(OBLIGATION_CATEGORIES).toHaveLength(expected.length);
  });
});

describe("OBLIGATION_FREQUENCIES", () => {
  it("contains expected values", () => {
    const expected = ["event-driven", "annual", "quarterly", "monthly", "continuous"];
    for (const v of expected) expect(OBLIGATION_FREQUENCIES).toContain(v);
    expect(OBLIGATION_FREQUENCIES).toHaveLength(expected.length);
  });
});

describe("CONTROL_TYPES", () => {
  it("contains expected values", () => {
    expect(CONTROL_TYPES).toContain("preventive");
    expect(CONTROL_TYPES).toContain("detective");
    expect(CONTROL_TYPES).toContain("corrective");
    expect(CONTROL_TYPES).toHaveLength(3);
  });
});

describe("CONTROL_IMPLEMENTATION_STATUSES", () => {
  it("contains expected values", () => {
    const expected = ["planned", "in-progress", "implemented", "not-applicable"];
    for (const v of expected) expect(CONTROL_IMPLEMENTATION_STATUSES).toContain(v);
    expect(CONTROL_IMPLEMENTATION_STATUSES).toHaveLength(expected.length);
  });
});

describe("CONTROL_EFFECTIVENESS", () => {
  it("contains expected values", () => {
    const expected = ["effective", "partially-effective", "ineffective", "not-assessed"];
    for (const v of expected) expect(CONTROL_EFFECTIVENESS).toContain(v);
    expect(CONTROL_EFFECTIVENESS).toHaveLength(expected.length);
  });
});

describe("EVIDENCE_TYPES", () => {
  it("contains expected values", () => {
    const expected = ["policy", "procedure", "training-record", "audit-report", "test-result", "incident-report", "approval", "submission", "assessment", "other"];
    for (const v of expected) expect(EVIDENCE_TYPES).toContain(v);
    expect(EVIDENCE_TYPES).toHaveLength(expected.length);
  });
});

describe("RISK_LIKELIHOODS", () => {
  it("contains expected values", () => {
    const expected = ["rare", "unlikely", "possible", "likely", "almost-certain"];
    for (const v of expected) expect(RISK_LIKELIHOODS).toContain(v);
    expect(RISK_LIKELIHOODS).toHaveLength(expected.length);
  });
});

describe("RISK_SEVERITIES", () => {
  it("contains expected values", () => {
    const expected = ["negligible", "minor", "moderate", "major", "catastrophic"];
    for (const v of expected) expect(RISK_SEVERITIES).toContain(v);
    expect(RISK_SEVERITIES).toHaveLength(expected.length);
  });
});

describe("RISK_LEVELS", () => {
  it("contains expected values", () => {
    const expected = ["low", "medium", "high", "critical"];
    for (const v of expected) expect(RISK_LEVELS).toContain(v);
    expect(RISK_LEVELS).toHaveLength(expected.length);
  });
});

describe("INCIDENT_SEVERITIES", () => {
  it("contains expected values", () => {
    const expected = ["low", "medium", "high", "critical"];
    for (const v of expected) expect(INCIDENT_SEVERITIES).toContain(v);
    expect(INCIDENT_SEVERITIES).toHaveLength(expected.length);
  });
});

describe("INCIDENT_CATEGORIES", () => {
  it("contains expected values", () => {
    const expected = ["data-breach", "safety", "financial", "environmental", "operational", "other"];
    for (const v of expected) expect(INCIDENT_CATEGORIES).toContain(v);
    expect(INCIDENT_CATEGORIES).toHaveLength(expected.length);
  });
});

describe("INCIDENT_STATUSES", () => {
  it("contains expected values", () => {
    const expected = ["open", "investigating", "remediated", "closed"];
    for (const v of expected) expect(INCIDENT_STATUSES).toContain(v);
    expect(INCIDENT_STATUSES).toHaveLength(expected.length);
  });
});

describe("CORRECTIVE_ACTION_STATUSES", () => {
  it("contains expected values", () => {
    const expected = ["open", "in-progress", "completed", "verified", "overdue"];
    for (const v of expected) expect(CORRECTIVE_ACTION_STATUSES).toContain(v);
    expect(CORRECTIVE_ACTION_STATUSES).toHaveLength(expected.length);
  });
});

describe("CORRECTIVE_ACTION_SOURCE_TYPES", () => {
  it("contains expected values", () => {
    const expected = ["incident", "audit-finding", "gap-assessment", "management-review"];
    for (const v of expected) expect(CORRECTIVE_ACTION_SOURCE_TYPES).toContain(v);
    expect(CORRECTIVE_ACTION_SOURCE_TYPES).toHaveLength(expected.length);
  });
});

describe("AUDIT_TYPES", () => {
  it("contains expected values", () => {
    const expected = ["internal", "external", "certification", "regulatory-inspection"];
    for (const v of expected) expect(AUDIT_TYPES).toContain(v);
    expect(AUDIT_TYPES).toHaveLength(expected.length);
  });
});

describe("AUDIT_STATUSES", () => {
  it("contains expected values", () => {
    const expected = ["planned", "in-progress", "completed", "cancelled"];
    for (const v of expected) expect(AUDIT_STATUSES).toContain(v);
    expect(AUDIT_STATUSES).toHaveLength(expected.length);
  });
});

describe("AUDIT_RATINGS", () => {
  it("contains expected values", () => {
    const expected = ["conforming", "minor-nonconformity", "major-nonconformity", "observation"];
    for (const v of expected) expect(AUDIT_RATINGS).toContain(v);
    expect(AUDIT_RATINGS).toHaveLength(expected.length);
  });
});

describe("FINDING_TYPES", () => {
  it("contains expected values", () => {
    const expected = ["nonconformity-major", "nonconformity-minor", "observation", "opportunity"];
    for (const v of expected) expect(FINDING_TYPES).toContain(v);
    expect(FINDING_TYPES).toHaveLength(expected.length);
  });
});

describe("SUBMISSION_TYPES", () => {
  it("contains expected values", () => {
    const expected = ["breach-notification", "annual-report", "certification", "license-renewal", "incident-report"];
    for (const v of expected) expect(SUBMISSION_TYPES).toContain(v);
    expect(SUBMISSION_TYPES).toHaveLength(expected.length);
  });
});

describe("SUBMISSION_STATUSES", () => {
  it("contains expected values", () => {
    const expected = ["draft", "pending", "submitted", "acknowledged", "rejected"];
    for (const v of expected) expect(SUBMISSION_STATUSES).toContain(v);
    expect(SUBMISSION_STATUSES).toHaveLength(expected.length);
  });
});

// ─── Validator Tests ──────────────────────────────────────────────────────────

describe("validateRegulationInput()", () => {
  const validInput: RegulationInput = {
    name: "GDPR",
    shortName: "GDPR",
    jurisdiction: "EU",
  };

  it("returns null for valid input", () => {
    expect(validateRegulationInput(validInput)).toBeNull();
  });

  it("returns null for valid input with optional fields", () => {
    const input: RegulationInput = {
      ...validInput,
      industry: "Finance",
      sourceType: "external",
      effectiveDate: new Date("2018-05-25"),
      reviewDate: new Date("2025-01-01"),
      sourceUrl: "https://gdpr.eu",
      notes: "Key regulation",
    };
    expect(validateRegulationInput(input)).toBeNull();
  });

  it("returns error when name is empty", () => {
    expect(validateRegulationInput({ ...validInput, name: "" })).toMatch(/name/i);
  });

  it("returns error when name is whitespace only", () => {
    expect(validateRegulationInput({ ...validInput, name: "   " })).toMatch(/name/i);
  });

  it("returns error when shortName is empty", () => {
    expect(validateRegulationInput({ ...validInput, shortName: "" })).toMatch(/short.?name/i);
  });

  it("returns error when shortName is whitespace only", () => {
    expect(validateRegulationInput({ ...validInput, shortName: "   " })).toMatch(/short.?name/i);
  });

  it("returns error when jurisdiction is empty", () => {
    expect(validateRegulationInput({ ...validInput, jurisdiction: "" })).toMatch(/jurisdiction/i);
  });

  it("returns error when jurisdiction is whitespace only", () => {
    expect(validateRegulationInput({ ...validInput, jurisdiction: "   " })).toMatch(/jurisdiction/i);
  });
});

describe("validateObligationInput()", () => {
  const validInput: ObligationInput = {
    title: "Annual privacy audit",
    regulationId: "REG-ABCD1234",
  };

  it("returns null for valid input", () => {
    expect(validateObligationInput(validInput)).toBeNull();
  });

  it("returns null for valid input with optional fields", () => {
    const input: ObligationInput = {
      ...validInput,
      description: "Conduct annual audit",
      reference: "Art. 35",
      category: "data-protection",
      frequency: "annual",
      applicability: "All EU operations",
      penaltySummary: "Up to 4% global turnover",
      ownerEmployeeId: "EMP-001",
      reviewDate: new Date("2026-01-01"),
    };
    expect(validateObligationInput(input)).toBeNull();
  });

  it("returns error when title is empty", () => {
    expect(validateObligationInput({ ...validInput, title: "" })).toMatch(/title/i);
  });

  it("returns error when title is whitespace only", () => {
    expect(validateObligationInput({ ...validInput, title: "   " })).toMatch(/title/i);
  });

  it("returns error when regulationId is empty", () => {
    expect(validateObligationInput({ ...validInput, regulationId: "" })).toMatch(/regulation/i);
  });

  it("returns error when regulationId is whitespace only", () => {
    expect(validateObligationInput({ ...validInput, regulationId: "   " })).toMatch(/regulation/i);
  });
});

describe("validateControlInput()", () => {
  const validInput: ControlInput = {
    title: "Access control review",
    controlType: "preventive",
  };

  it("returns null for valid input", () => {
    expect(validateControlInput(validInput)).toBeNull();
  });

  it("returns null for all valid controlType values", () => {
    for (const t of CONTROL_TYPES) {
      expect(validateControlInput({ ...validInput, controlType: t })).toBeNull();
    }
  });

  it("returns null for valid input with optional fields", () => {
    const input: ControlInput = {
      ...validInput,
      description: "Quarterly review of access rights",
      implementationStatus: "implemented",
      ownerEmployeeId: "EMP-042",
      reviewFrequency: "quarterly",
      nextReviewDate: new Date("2026-06-01"),
      effectiveness: "effective",
    };
    expect(validateControlInput(input)).toBeNull();
  });

  it("returns error when title is empty", () => {
    expect(validateControlInput({ ...validInput, title: "" })).toMatch(/title/i);
  });

  it("returns error when title is whitespace only", () => {
    expect(validateControlInput({ ...validInput, title: "   " })).toMatch(/title/i);
  });

  it("returns error when controlType is invalid", () => {
    expect(validateControlInput({ ...validInput, controlType: "invalid-type" })).toMatch(/control.?type/i);
  });

  it("returns error when controlType is empty", () => {
    expect(validateControlInput({ ...validInput, controlType: "" })).toMatch(/control.?type/i);
  });
});
