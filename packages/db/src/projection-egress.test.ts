import { describe, expect, it } from "vitest";

import {
  DEFAULT_INCIDENT_PROJECTION,
  projectIncidentForEgress,
  resolveIncidentProjectionSpec,
} from "./projection-egress";

describe("resolveIncidentProjectionSpec", () => {
  it("falls back to minimum-necessary when nothing is stored", () => {
    expect(resolveIncidentProjectionSpec(undefined)).toEqual(DEFAULT_INCIDENT_PROJECTION);
    expect(resolveIncidentProjectionSpec(null)).toEqual(DEFAULT_INCIDENT_PROJECTION);
    expect(resolveIncidentProjectionSpec("nonsense")).toEqual(DEFAULT_INCIDENT_PROJECTION);
  });

  it("falls back when includeSlices is empty — 'no contract' is NOT 'send everything'", () => {
    expect(resolveIncidentProjectionSpec({ includeSlices: [] })).toEqual(DEFAULT_INCIDENT_PROJECTION);
    expect(resolveIncidentProjectionSpec({ excludeSlices: ["incident"] })).toEqual(DEFAULT_INCIDENT_PROJECTION);
  });

  it("coerces a valid stored projection, defaulting retention to short", () => {
    const spec = resolveIncidentProjectionSpec({
      includeSlices: ["incident", 7],
      excludeSlices: ["secrets"],
      fieldAllowList: { incident: ["incidentKey", "summary", 9], junk: "x" },
      retentionClass: "bogus",
    });
    expect(spec.includeSlices).toEqual(["incident"]);
    expect(spec.excludeSlices).toEqual(["secrets"]);
    expect(spec.fieldAllowList).toEqual({ incident: ["incidentKey", "summary"] });
    expect(spec.retentionClass).toBe("short");
  });

  it("preserves a valid retention class", () => {
    expect(
      resolveIncidentProjectionSpec({ includeSlices: ["incident"], retentionClass: "compliance-hold" }).retentionClass,
    ).toBe("compliance-hold");
  });
});

describe("projectIncidentForEgress", () => {
  const incident = {
    incidentKey: "edge-incident|node|x|t",
    summary: "interface down on fw-01",
    highestSeverity: "error",
    alertCount: 2,
    payloadHash: "abc123",
  };

  it("passes a minimum-necessary incident clean (no violations)", () => {
    const res = projectIncidentForEgress(DEFAULT_INCIDENT_PROJECTION, incident);
    expect(res.violations).toEqual([]);
    expect(res.payload).toEqual(incident);
  });

  it("drops fields not on the allow-list (minimum-necessary)", () => {
    const res = projectIncidentForEgress(DEFAULT_INCIDENT_PROJECTION, {
      ...incident,
      internalCustomerName: "Acme Health LLP",
      rawNote: "anything",
    });
    expect(res.violations).toEqual([]);
    expect(res.payload).toEqual(incident); // extras gone
    expect(res.excluded.fields).toEqual(
      expect.arrayContaining(["incident.internalCustomerName", "incident.rawNote"]),
    );
  });

  it("strips a forbidden-class field even if the incident carries it, with no egress violation", () => {
    const res = projectIncidentForEgress(
      // a (mis)configured contract that allow-lists a PHI field…
      { includeSlices: ["incident"], excludeSlices: [], fieldAllowList: { incident: ["incidentKey", "diagnosis"] } },
      { incidentKey: "k", diagnosis: "confidential", summary: "x" },
    );
    // forbidden guard removed it before the wire; proof stays clean.
    expect(res.payload).toEqual({ incidentKey: "k" });
    expect(res.violations).toEqual([]);
    expect(res.excluded.forbidden).toEqual(expect.arrayContaining(["incident.diagnosis"]));
  });
});
