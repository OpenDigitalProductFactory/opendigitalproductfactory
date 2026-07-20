import { describe, expect, it } from "vitest";

import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";

import { buildDemandEnvelope } from "./demand-projection";

const source = {
  localRecordRef: "BI-PRIVATE-123",
  title: "Portable capability request",
  summary: "A share-safe explanation of the reusable need.",
  workType: "feature",
  occurrenceCount: 3,
  product: "dpf-portal",
  createdAt: new Date("2026-07-20T06:00:00.000Z"),
  updatedAt: new Date("2026-07-20T06:05:00.000Z"),
};

describe("buildDemandEnvelope", () => {
  it("projects a valid internal envelope with stable opaque references and digest", () => {
    const result = buildDemandEnvelope({
      source,
      identity: { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) },
      contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
      audience: "internal",
      attribution: "organization",
    });

    expect(result.violations).toEqual([]);
    expect(result.envelope).toMatchObject({
      specVersion: "dpf.demand/1",
      title: source.title,
      summary: source.summary,
      audience: "internal",
      signal: { occurrenceCount: 3 },
      applicability: { product: "dpf-portal" },
      originVersion: source.updatedAt.getTime(),
    });
    expect(result.envelope.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(result.envelope)).not.toContain(source.localRecordRef);
  });

  it("honors a narrower partner contract and never serializes local planning context", () => {
    const result = buildDemandEnvelope({
      source: {
        ...source,
        privatePlanning: { priority: 1, estimate: 13, workCapsuleId: "WC-SECRET" },
      } as typeof source,
      identity: { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) },
      contract: {
        ...DEMAND_PROJECTION_TEMPLATES.channel,
        fieldAllowList: {
          demand: [
            "specVersion", "envelopeId", "originInstallationId", "originRecordRef", "originVersion",
            "route", "audience", "title", "summary", "signal", "attribution", "createdAt", "updatedAt",
            "payloadDigest",
          ],
        },
      },
      audience: "partner",
      attribution: "pseudonymous",
    });

    expect(result.violations).toEqual([]);
    expect(result.envelope).not.toHaveProperty("workType");
    expect(result.envelope).not.toHaveProperty("applicability");
    expect(JSON.stringify(result.envelope)).not.toContain("WC-SECRET");
    expect(JSON.stringify(result.envelope)).not.toContain("estimate");
  });
});
