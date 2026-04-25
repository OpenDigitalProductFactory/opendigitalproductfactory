import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    authorityBinding: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  inferAuthorityBindings,
  materializeAuthorityBindings,
  type AuthorityBindingInferenceInput,
} from "./bootstrap-bindings";

describe("inferAuthorityBindings", () => {
  it("collapses duplicate route and coworker mappings into one binding candidate", () => {
    const input: AuthorityBindingInferenceInput[] = [
      {
        resourceType: "route",
        resourceRef: "/finance",
        appliedAgentId: "finance-controller",
        approvalMode: "proposal-required",
        subjects: [{ subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" }],
      },
      {
        resourceType: "route",
        resourceRef: "/finance",
        appliedAgentId: "finance-controller",
        approvalMode: "proposal-required",
        subjects: [{ subjectType: "team", subjectRef: "finance", relation: "owner" }],
      },
    ];

    const result = inferAuthorityBindings(input);

    expect(result).toEqual([
      expect.objectContaining({
        bindingId: "AB-ROUTE-FINANCE-FINANCE-CONTROLLER",
        resourceRef: "/finance",
        appliedAgentId: "finance-controller",
        subjects: [
          { subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" },
          { subjectType: "team", subjectRef: "finance", relation: "owner" },
        ],
      }),
    ]);
  });
});

describe("materializeAuthorityBindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports dry run without writing bindings", async () => {
    vi.mocked(prisma.authorityBinding.findMany).mockResolvedValue([] as never);

    const result = await materializeAuthorityBindings(
      [
        {
          bindingId: "AB-ROUTE-FINANCE-FINANCE-CONTROLLER",
          name: "Finance controller on /finance",
          scopeType: "route",
          status: "active",
          resourceType: "route",
          resourceRef: "/finance",
          approvalMode: "proposal-required",
          appliedAgentId: "finance-controller",
          subjects: [],
          grants: [],
        },
      ],
      { dryRun: true },
    );

    expect(result).toEqual({
      created: 0,
      skippedExisting: 0,
      wouldCreate: 1,
    });
    expect(prisma.authorityBinding.create).not.toHaveBeenCalled();
  });

  it("skips bindings that already exist by business id", async () => {
    vi.mocked(prisma.authorityBinding.findMany).mockResolvedValue([
      { bindingId: "AB-ROUTE-FINANCE-FINANCE-CONTROLLER" },
    ] as never);

    const result = await materializeAuthorityBindings(
      [
        {
          bindingId: "AB-ROUTE-FINANCE-FINANCE-CONTROLLER",
          name: "Finance controller on /finance",
          scopeType: "route",
          status: "active",
          resourceType: "route",
          resourceRef: "/finance",
          approvalMode: "proposal-required",
          appliedAgentId: "finance-controller",
          subjects: [],
          grants: [],
        },
      ],
      { dryRun: false },
    );

    expect(result.skippedExisting).toBe(1);
    expect(prisma.authorityBinding.create).not.toHaveBeenCalled();
  });
});
