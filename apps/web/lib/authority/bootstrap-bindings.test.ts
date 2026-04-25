import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findMany: vi.fn(),
    },
    authorityBinding: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/govern/permissions", () => ({
  PERMISSIONS: {
    view_finance: { roles: ["HR-000", "HR-200"] },
    view_platform: { roles: ["HR-000", "HR-300"] },
  },
}));

vi.mock("@/lib/tak/agent-routing", () => ({
  ROUTE_AGENT_MAP_ENTRIES: [
    [
      "/finance",
      {
        agentId: "finance-controller",
        agentName: "Finance Controller",
        capability: "view_finance",
      },
    ],
    [
      "/workspace",
      {
        agentId: "coo",
        agentName: "COO",
        capability: "view_platform",
      },
    ],
    [
      "/setup",
      {
        agentId: "onboarding-coo",
        agentName: "Onboarding COO",
        capability: null,
      },
    ],
  ],
}));

import { prisma } from "@dpf/db";
import {
  bootstrapAuthorityBindings,
  buildDraftAuthorityBindingFromWarning,
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
    vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);

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
    vi.mocked(prisma.agent.findMany).mockResolvedValue([] as never);

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

  it("writes nested subjects and resolves the applied coworker row id", async () => {
    vi.mocked(prisma.authorityBinding.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        id: "agent-row-1",
        agentId: "finance-controller",
      },
    ] as never);

    await materializeAuthorityBindings(
      [
        {
          bindingId: "AB-ROUTE-FINANCE-FINANCE-CONTROLLER",
          name: "Finance controller on /finance",
          scopeType: "route",
          status: "active",
          resourceType: "route",
          resourceRef: "/finance",
          approvalMode: "none",
          appliedAgentId: "finance-controller",
          subjects: [{ subjectType: "platform-role", subjectRef: "HR-200", relation: "allowed" }],
          grants: [],
        },
      ],
      { dryRun: false },
    );

    expect(prisma.authorityBinding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appliedAgentId: "agent-row-1",
          subjects: {
            create: [{ subjectType: "platform-role", subjectRef: "HR-200", relation: "allowed" }],
          },
        }),
      }),
    );
  });
});

describe("bootstrapAuthorityBindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives high-confidence route bindings from the route map and permission subjects", async () => {
    vi.mocked(prisma.authorityBinding.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        id: "agent-row-1",
        agentId: "finance-controller",
        name: "Finance Controller",
        ownerships: [],
      },
      {
        id: "agent-row-2",
        agentId: "coo",
        name: "COO",
        ownerships: [],
      },
      {
        id: "agent-row-3",
        agentId: "onboarding-coo",
        name: "Onboarding COO",
        ownerships: [
          {
            team: {
              teamId: "TEAM-ONBOARD",
              slug: "onboarding",
              name: "Onboarding",
            },
          },
        ],
      },
    ] as never);

    const report = await bootstrapAuthorityBindings({ writeMode: "dry-run" });

    expect(report.wouldCreate).toBe(2);
    expect(report.lowConfidence).toContainEqual(
      expect.objectContaining({
        resourceRef: "/setup",
        reason: "ungated-route",
      }),
    );
    expect(report.candidates).toContainEqual(
      expect.objectContaining({
        bindingId: "AB-ROUTE-FINANCE-FINANCE-CONTROLLER",
        subjects: [
          { subjectType: "platform-role", subjectRef: "HR-000", relation: "allowed" },
          { subjectType: "platform-role", subjectRef: "HR-200", relation: "allowed" },
        ],
      }),
    );
  });

  it("builds a draft binding candidate from a low-confidence warning", async () => {
    vi.mocked(prisma.agent.findMany).mockResolvedValue([
      {
        id: "agent-row-3",
        agentId: "onboarding-coo",
        name: "Onboarding COO",
        ownerships: [
          {
            team: {
              teamId: "TEAM-ONBOARD",
              slug: "onboarding",
              name: "Onboarding",
            },
          },
        ],
      },
    ] as never);

    const candidate = await buildDraftAuthorityBindingFromWarning({
      resourceRef: "/setup",
      agentId: "onboarding-coo",
      reason: "ungated-route",
    });

    expect(candidate).toEqual(
      expect.objectContaining({
        bindingId: "AB-ROUTE-SETUP-ONBOARDING-COO",
        name: "Review /setup authority binding",
        status: "draft",
        resourceRef: "/setup",
        appliedAgentId: "onboarding-coo",
        subjects: [{ subjectType: "team", subjectRef: "TEAM-ONBOARD", relation: "owner" }],
      }),
    );
  });
});
