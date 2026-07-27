import { describe, expect, it, vi } from "vitest";

import {
  getAuthorityBindingFilterOptions,
  listAuthorityBindingRecords,
  parseAuthorityBindingFilters,
  shapeAuthorityBindingRows,
  type AuthorityBindingRecord,
} from "./bindings";

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    authorityBinding: {
      findMany: mockFindMany,
    },
  },
}));

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

describe("parseAuthorityBindingFilters", () => {
  it("normalizes string and array search params into binding filters", () => {
    expect(
      parseAuthorityBindingFilters({
        status: "active",
        resource: ["/finance", "/workspace"],
        coworker: "finance-controller",
        subject: "HR-400",
      }),
    ).toEqual({
      statuses: ["active"],
      resourceRefs: ["/finance", "/workspace"],
      appliedAgentIds: ["finance-controller"],
      subjectRefs: ["HR-400"],
    });
  });

  it("omits empty filter dimensions", () => {
    expect(parseAuthorityBindingFilters({ status: "", resource: undefined })).toEqual({});
  });
});

describe("getAuthorityBindingFilterOptions", () => {
  it("derives sorted filter options from binding records", () => {
    expect(getAuthorityBindingFilterOptions(SAMPLE_RECORDS)).toEqual({
      statuses: ["active"],
      resourceRefs: ["/finance"],
      appliedAgents: [{ agentId: "AGT-400", agentName: "Finance Controller" }],
      subjectRefs: ["HR-400", "finance"],
    });
  });
});

describe("listAuthorityBindingRecords", () => {
  it("filters work-pattern authority out of the route-authorization admin reader", async () => {
    mockFindMany.mockResolvedValue([]);

    await listAuthorityBindingRecords();

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          resourceType: { not: "work-pattern" },
        }),
      }),
    );
  });
});
