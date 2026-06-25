import { describe, expect, it } from "vitest";
import {
  assertNoExcludedEgress,
  isForbiddenField,
  projectEstatePayload,
  toCloudEvent,
  type ProjectionContractSpec,
} from "./projection-serialization";

const contract: ProjectionContractSpec = {
  includeSlices: ["health", "inventory", "incidents", "slo"],
  excludeSlices: ["documents", "matters", "financials"],
  fieldAllowList: {
    inventory: ["deviceId", "kind", "status", "lastSeenAt"],
  },
  retentionClass: "standard",
};

describe("isForbiddenField (HIPAA/privilege egress guard)", () => {
  it("flags sensitive classes regardless of separators/casing", () => {
    for (const k of ["ssn", "patient_id", "PHI", "matterNumber", "attorney_notes", "account_number", "api_key", "document_body", "raw-log"]) {
      expect(isForbiddenField(k)).toBe(true);
    }
  });
  it("allows benign operational fields", () => {
    for (const k of ["hostname", "severity", "deviceId", "status", "lastSeenAt", "cpuPercent"]) {
      expect(isForbiddenField(k)).toBe(false);
    }
  });
});

describe("projectEstatePayload (B2 minimum-necessary)", () => {
  const payload = {
    health: { status: "degraded", cpuPercent: 91 },
    inventory: { deviceId: "fw-01", kind: "firewall", status: "up", lastSeenAt: "t", serialNumber: "SN-secret", notes: "internal" },
    incidents: { count: 2, items: [{ title: "iface down", patientName: "should-never-cross" }] },
    documents: { body: "privileged client memo" },
    matters: { caseId: "M-1" },
    financials: { payroll: 1234 },
  };

  it("emits only included slices and drops excluded + non-included ones", () => {
    const { projected, excluded } = projectEstatePayload(contract, payload);
    expect(Object.keys(projected).sort()).toEqual(["health", "incidents", "inventory", "slo"].filter((s) => s in payload).sort());
    expect(projected.documents).toBeUndefined();
    expect(projected.matters).toBeUndefined();
    expect(projected.financials).toBeUndefined();
    expect(excluded.slices).toEqual(expect.arrayContaining(["documents", "matters", "financials"]));
  });

  it("applies the per-slice field allow-list", () => {
    const { projected, excluded } = projectEstatePayload(contract, payload);
    expect(projected.inventory).toEqual({ deviceId: "fw-01", kind: "firewall", status: "up", lastSeenAt: "t" });
    expect(excluded.fields).toEqual(expect.arrayContaining(["inventory.serialNumber", "inventory.notes"]));
  });

  it("strips forbidden fields anywhere in the tree even inside an included slice", () => {
    const { projected, excluded } = projectEstatePayload(contract, payload);
    const incidents = projected.incidents as { items: Array<Record<string, unknown>> };
    expect(incidents.items[0].patientName).toBeUndefined();
    expect(incidents.items[0].title).toBe("iface down");
    expect(excluded.forbidden).toEqual(expect.arrayContaining(["incidents.items[0].patientName"]));
  });

  it("the projection passes the negative-egress proof", () => {
    const { projected } = projectEstatePayload(contract, payload);
    expect(assertNoExcludedEgress(contract, projected)).toEqual([]);
  });

  it("the proof CATCHES a hand-injected excluded slice or forbidden field", () => {
    const tampered = { health: { status: "ok" }, financials: { payroll: 1 }, inventory: { ssn: "x" } };
    const violations = assertNoExcludedEgress(contract, tampered);
    expect(violations).toEqual(expect.arrayContaining(["excluded-slice:financials", "forbidden-field:inventory.ssn"]));
  });
});

describe("toCloudEvent", () => {
  it("wraps a projection in a CloudEvents 1.0 envelope with the link id", () => {
    const ev = toCloudEvent({ id: "1", source: "/msp", type: "dpf.federation.projection", time: "2026-06-24T00:00:00Z", linkId: "link_1", data: { health: {} } });
    expect(ev.specversion).toBe("1.0");
    expect(ev.datacontenttype).toBe("application/json");
    expect(ev.dpflinkid).toBe("link_1");
    expect(ev.data).toEqual({ health: {} });
  });
});
