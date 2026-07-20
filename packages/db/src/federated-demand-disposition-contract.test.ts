import { describe, expect, it } from "vitest";

import {
  computeDemandDispositionDigest,
  validateDemandDispositionNoticeV1,
  type DemandDispositionNoticeV1,
} from "./federated-demand-contract";

function notice(): DemandDispositionNoticeV1 {
  const value: DemandDispositionNoticeV1 = {
    specVersion: "dpf.demand-disposition/1",
    noticeId: "fdn_opaque",
    envelopeId: "dem_opaque",
    originInstallationId: `inst_${"a".repeat(32)}`,
    decision: "accepted",
    releaseApplicability: { releaseRef: "release_opaque", applicability: "Compatible installations can adopt this release." },
    createdAt: "2026-07-20T08:00:00.000Z",
    payloadDigest: "sha256:pending",
  };
  value.payloadDigest = computeDemandDispositionDigest(value);
  return value;
}

describe("demand disposition notice", () => {
  it("carries only an opaque decision and optional release applicability", () => {
    expect(validateDemandDispositionNoticeV1(notice())).toEqual([]);
  });

  it("rejects local backlog identifiers and unknown payload fields", () => {
    expect(validateDemandDispositionNoticeV1({ ...notice(), backlogItemId: "BI-SECRET" }))
      .toContain("field:not-allowed:backlogItemId");
  });
});
