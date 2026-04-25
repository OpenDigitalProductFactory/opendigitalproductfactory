import { describe, expect, it } from "vitest";

import { shapeAuthorityBindingRows, type AuthorityBindingRecord } from "./bindings";

const SAMPLE_RECORDS: AuthorityBindingRecord[] = [
  {
    bindingId: "AB-000001",
    name: "Finance workspace controller",
    scopeType: "route",
    status: "active",
    resourceType: "route",
    resourceRef: "/finance",
    approvalMode: "proposal-required",
    sensitivityCeiling: "confidential",
    appliedAgentId: "AGT-400",
    appliedAgentName: "Finance Controller",
    subjects: [
      { subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" },
      { subjectType: "team", subjectRef: "finance", relation: "owner" },
    ],
    grants: [{ grantKey: "ledger_write", mode: "require-approval", rationale: "Needs review" }],
  },
];

describe("shapeAuthorityBindingRows", () => {
  it("groups bindings by subject for the human-first pivot", () => {
    const result = shapeAuthorityBindingRows(SAMPLE_RECORDS, "subject");

    expect(result).toContainEqual(
      expect.objectContaining({
        bindingId: "AB-000001",
        pivotKind: "subject",
        pivotLabel: "HR-400",
        resourceRef: "/finance",
        appliedAgentName: "Finance Controller",
      }),
    );
  });

  it("groups bindings by coworker for the coworker-first pivot", () => {
    const result = shapeAuthorityBindingRows(SAMPLE_RECORDS, "coworker");

    expect(result).toEqual([
      expect.objectContaining({
        bindingId: "AB-000001",
        pivotKind: "coworker",
        pivotLabel: "Finance Controller",
        subjectLabels: ["HR-400", "finance"],
      }),
    ]);
  });
});
