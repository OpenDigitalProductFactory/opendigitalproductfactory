import { describe, expect, it } from "vitest";
import { projectEstatePayload } from "./projection-serialization";
import {
  DEMAND_ACTIVITIES,
  DEMAND_ATTRIBUTIONS,
  DEMAND_AUDIENCES,
  DEMAND_PROJECTION_TEMPLATES,
  DEMAND_SCHEMA_VERSIONS,
  computeDemandPayloadDigest,
  validateDemandEnvelopeV1,
  validateDemandDigestV1,
  type DemandDigestV1,
  type DemandEnvelopeV1,
} from "./federated-demand-contract";
import { FEDERATION_RELATIONSHIP_PRESETS } from "./federation-link-types";

const envelope = (overrides: Partial<DemandEnvelopeV1> = {}): DemandEnvelopeV1 => {
  const value: DemandEnvelopeV1 = {
    specVersion: "dpf.demand/1",
    envelopeId: "dem_01",
    originInstallationId: "inst_opaque_a",
    originRecordRef: "ref_opaque_1",
    originVersion: 1,
    route: [],
    audience: "internal",
    title: "Shared platform demand",
    summary: "A share-safe summary",
    workType: "feature",
    applicability: { product: "DPF", capabilityRefs: ["CAP-1"] },
    evidence: [{ kind: "test", digest: "sha256:test" }],
    signal: { occurrenceCount: 2, affectedOrganizations: 1 },
    attribution: "pseudonymous",
    createdAt: "2026-07-19T20:00:00.000Z",
    updatedAt: "2026-07-19T20:00:00.000Z",
    payloadDigest: "sha256:pending",
    ...overrides,
  };
  if (overrides.payloadDigest === undefined) value.payloadDigest = computeDemandPayloadDigest(value);
  return value;
};

describe("federated demand registries", () => {
  it("pins the v1 schema, activity, audience, and attribution vocabulary", () => {
    expect(DEMAND_SCHEMA_VERSIONS).toEqual(["dpf.demand/1"]);
    expect(DEMAND_ACTIVITIES).toEqual([
      "dpf.demand.proposed",
      "dpf.demand.updated",
      "dpf.demand.withdrawn",
      "dpf.demand.interest-recorded",
      "dpf.demand.help-offered",
      "dpf.demand.adopted",
      "dpf.demand.dispositioned",
      "dpf.release.applicability-published",
    ]);
    expect(DEMAND_AUDIENCES).toEqual(["internal", "partner", "founder", "community"]);
    expect(DEMAND_ATTRIBUTIONS).toEqual(["named", "organization", "pseudonymous", "anonymous"]);
  });
});

describe("validateDemandEnvelopeV1", () => {
  it("accepts a conforming envelope", () => {
    expect(validateDemandEnvelopeV1(envelope())).toEqual([]);
  });

  it("rejects unknown vocabulary, oversized content, bad counts, and non-advancing versions", () => {
    const invalid = {
      ...envelope(),
      audience: "public",
      title: "x".repeat(241),
      signal: { occurrenceCount: -1 },
    };
    expect(validateDemandEnvelopeV1(invalid, { previousOriginVersion: 1 })).toEqual(expect.arrayContaining([
      "audience:unsupported",
      "title:too-long",
      "signal.occurrenceCount:invalid",
      "originVersion:not-advancing",
    ]));
  });

  it("rejects routes that loop through the receiver or repeat an installation", () => {
    const routed = envelope({
      route: [
        { installationId: "inst_b", relationshipKind: "channel", receivedAt: "2026-07-19T20:01:00.000Z", attestationDigest: "sha256:b" },
        { installationId: "inst_b", relationshipKind: "channel", receivedAt: "2026-07-19T20:02:00.000Z", attestationDigest: "sha256:c" },
        { installationId: "inst_receiver", relationshipKind: "channel", receivedAt: "2026-07-19T20:03:00.000Z", attestationDigest: "sha256:d" },
      ],
    });
    expect(validateDemandEnvelopeV1(routed, { receivingInstallationId: "inst_receiver" })).toEqual(expect.arrayContaining([
      "route:duplicate-installation:inst_b",
      "route:receiver-loop",
    ]));
  });

  it("rejects undeclared fields so a BacklogItem cannot masquerade as a demand envelope", () => {
    expect(validateDemandEnvelopeV1({
      ...envelope(),
      backlogItemId: "BI-PRIVATE",
      priority: "urgent",
      workCapsule: { id: "WC-PRIVATE" },
    })).toEqual(expect.arrayContaining([
      "field:not-allowed:backlogItemId",
      "field:not-allowed:priority",
      "field:not-allowed:workCapsule",
    ]));
  });

  it("rejects a payload whose claimed digest does not match its content", () => {
    expect(validateDemandEnvelopeV1(envelope({ payloadDigest: `sha256:${"0".repeat(64)}` })))
      .toContain("payloadDigest:mismatch");
  });
});

describe("relationship projection templates", () => {
  it("defines a minimum-necessary template for every relationship preset", () => {
    expect(Object.keys(DEMAND_PROJECTION_TEMPLATES).sort()).toEqual([...FEDERATION_RELATIONSHIP_PRESETS].sort());
  });

  it.each(FEDERATION_RELATIONSHIP_PRESETS)("never projects local planning state for %s", (preset) => {
    const result = projectEstatePayload(DEMAND_PROJECTION_TEMPLATES[preset], {
      demand: {
        ...envelope(),
        backlogItemId: "BI-PRIVATE",
        workCapsuleId: "WC-PRIVATE",
        priority: "urgent",
        estimate: 13,
        discussion: "private rationale",
        customerContext: { customerName: "Private Customer" },
      },
      localBacklog: { status: "in-progress" },
      attachments: [{ fileContents: "private" }],
    });

    expect(result.projected).toHaveProperty("demand");
    expect(JSON.stringify(result.projected)).not.toContain("BI-PRIVATE");
    expect(JSON.stringify(result.projected)).not.toContain("WC-PRIVATE");
    expect(JSON.stringify(result.projected)).not.toContain("private rationale");
    expect(JSON.stringify(result.projected)).not.toContain("Private Customer");
    expect(result.excluded.slices).toEqual(expect.arrayContaining(["localBacklog", "attachments"]));
  });
});

describe("validateDemandDigestV1", () => {
  const digest: DemandDigestV1 = {
    specVersion: "dpf.demand-digest/1",
    originInstallationId: "inst_opaque_a",
    generatedAt: "2026-07-20T06:00:00.000Z",
    records: [{
      originRecordRef: "ref_opaque_1",
      originVersion: 3,
      payloadDigest: "sha256:payload",
      withdrawn: false,
    }],
  };

  it("accepts a bounded digest made only of opaque demand identities", () => {
    expect(validateDemandDigestV1(digest)).toEqual([]);
  });

  it("rejects oversized or malformed reconciliation inventories", () => {
    expect(validateDemandDigestV1({
      ...digest,
      records: Array.from({ length: 1_001 }, () => ({
        originRecordRef: "", originVersion: 0, payloadDigest: "", withdrawn: "no",
      })),
    })).toEqual(expect.arrayContaining(["records:too-many"]));
  });
});
