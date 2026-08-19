import { describe, expect, it } from "vitest";
import {
  mapApplication,
  mapCandidate,
  mapHarvestImportSet,
  mapJob,
  mapOffer,
  mapScorecard,
} from "./harvest-to-staging";

describe("harvest-to-staging mappers", () => {
  it("maps a job to a recruiting-job → JobRequisition staging record", () => {
    const rec = mapJob({
      id: 42,
      name: "Senior Motor Engineer",
      status: "open",
      updated_at: "2026-08-01T00:00:00Z",
      departments: [{ name: "Engineering" }],
      offices: [{ name: "Austin" }],
    });
    expect(rec.entityFamily).toBe("recruiting-job");
    expect(rec.externalId).toBe("42");
    expect(rec.sourceProvider).toBe("greenhouse");
    expect(rec.ownerSide).toBe("external");
    expect(rec.proposedLocalLink.entityType).toBe("JobRequisition");
    expect(rec.proposedLocalLink.status).toBe("candidate");
    expect(rec.displayFields).toContainEqual({ label: "Department", value: "Engineering" });
  });

  it("maps a candidate to recruiting-candidate → Candidate with a joined name", () => {
    const rec = mapCandidate({ id: 7, first_name: "Ana", last_name: "López", title: "CNC Operator" });
    expect(rec.entityFamily).toBe("recruiting-candidate");
    expect(rec.proposedLocalLink.entityType).toBe("Candidate");
    expect(rec.displayFields).toContainEqual({ label: "Name", value: "Ana López" });
  });

  it("maps an application with stage + status", () => {
    const rec = mapApplication({
      id: 99,
      status: "active",
      current_stage: { name: "Onsite" },
      applied_at: "2026-07-01T00:00:00Z",
    });
    expect(rec.entityFamily).toBe("recruiting-application");
    expect(rec.proposedLocalLink.entityType).toBe("Application");
    expect(rec.displayFields).toContainEqual({ label: "Stage", value: "Onsite" });
    expect(rec.sourceTimestamp).toBe("2026-07-01T00:00:00Z");
  });

  it("maps an offer WITHOUT leaking compensation into displayFields", () => {
    const rec = mapOffer({
      id: 5,
      status: "sent",
      starts_at: "2026-09-01",
      // A real Harvest offer carries custom compensation fields; the mapper reads none of them.
      ...({ custom_fields: { salary: { value: 250000 } } } as object),
    });
    expect(rec.entityFamily).toBe("recruiting-offer");
    expect(rec.displayFields).toContainEqual({ label: "Start date", value: "2026-09-01" });
    const serialized = JSON.stringify(rec.displayFields);
    expect(serialized).not.toContain("250000");
    expect(serialized.toLowerCase()).not.toContain("salary");
  });

  it("maps a scorecard's overall recommendation", () => {
    const rec = mapScorecard({ id: 3, overall_recommendation: "strong_yes" });
    expect(rec.entityFamily).toBe("recruiting-scorecard");
    expect(rec.displayFields).toContainEqual({ label: "Recommendation", value: "strong_yes" });
  });

  it("maps a full import set in a stable family order", () => {
    const recs = mapHarvestImportSet({
      jobs: [{ id: 1 }],
      candidates: [{ id: 2 }],
      applications: [{ id: 3 }],
      offers: [{ id: 4 }],
      scorecards: [{ id: 5 }],
    });
    expect(recs.map((r) => r.entityFamily)).toEqual([
      "recruiting-job",
      "recruiting-candidate",
      "recruiting-application",
      "recruiting-offer",
      "recruiting-scorecard",
    ]);
    expect(recs.every((r) => r.readOnly === true)).toBe(true);
  });
});
