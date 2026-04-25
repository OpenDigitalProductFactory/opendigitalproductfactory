import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: {
      findUnique: vi.fn(),
    },
    agentToolGrant: {
      findMany: vi.fn(),
    },
    authorityBinding: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  createAuthorityBinding,
  updateAuthorityBinding,
  validateBindingGrant,
} from "./binding-editor";

describe("validateBindingGrant", () => {
  it("rejects a binding grant that widens an intrinsic agent grant", async () => {
    await expect(
      validateBindingGrant({
        intrinsic: [],
        requested: [{ grantKey: "ledger_write", mode: "allow" }],
      }),
    ).rejects.toThrow(/cannot widen/i);
  });

  it("accepts a binding grant that narrows an intrinsic agent grant", async () => {
    await expect(
      validateBindingGrant({
        intrinsic: ["ledger_write"],
        requested: [{ grantKey: "ledger_write", mode: "require-approval" }],
      }),
    ).resolves.not.toThrow();
  });
});

describe("binding editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a binding with a resolved coworker and normalized rows", async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: "agent-row-1",
      agentId: "finance-controller",
      name: "Finance Controller",
    } as never);
    vi.mocked(prisma.agentToolGrant.findMany).mockResolvedValue([
      { grantKey: "ledger_write" },
    ] as never);
    vi.mocked(prisma.authorityBinding.create).mockResolvedValue({
      id: "binding-row-1",
      bindingId: "AB-000001",
    } as never);

    await createAuthorityBinding({
      bindingId: "AB-000001",
      name: "Finance workspace controller",
      scopeType: "route",
      status: "active",
      resourceType: "route",
      resourceRef: "/finance",
      approvalMode: "proposal-required",
      appliedAgentId: "finance-controller",
      subjects: [
        { subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" },
        { subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" },
      ],
      grants: [{ grantKey: "ledger_write", mode: "require-approval" }],
    });

    expect(prisma.authorityBinding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appliedAgentId: "agent-row-1",
          subjects: {
            create: [{ subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" }],
          },
          grants: {
            create: [{ grantKey: "ledger_write", mode: "require-approval", rationale: null }],
          },
        }),
      }),
    );
  });

  it("updates a binding and replaces nested subjects and grants", async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: "agent-row-2",
      agentId: "hr-specialist",
      name: "HR Specialist",
    } as never);
    vi.mocked(prisma.agentToolGrant.findMany).mockResolvedValue([
      { grantKey: "employee_write" },
    ] as never);
    vi.mocked(prisma.authorityBinding.update).mockResolvedValue({
      id: "binding-row-2",
      bindingId: "AB-000002",
    } as never);

    await updateAuthorityBinding("AB-000002", {
      appliedAgentId: "hr-specialist",
      subjects: [{ subjectType: "team", subjectRef: "people-ops", relation: "allowed" }],
      grants: [{ grantKey: "employee_write", mode: "deny", rationale: "Read only here" }],
    });

    expect(prisma.authorityBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bindingId: "AB-000002" },
        data: expect.objectContaining({
          appliedAgentId: "agent-row-2",
          subjects: {
            deleteMany: {},
            create: [{ subjectType: "team", subjectRef: "people-ops", relation: "allowed" }],
          },
          grants: {
            deleteMany: {},
            create: [{ grantKey: "employee_write", mode: "deny", rationale: "Read only here" }],
          },
        }),
      }),
    );
  });

  it("preserves the applied coworker when the update payload does not change it", async () => {
    vi.mocked(prisma.authorityBinding.update).mockResolvedValue({
      id: "binding-row-3",
      bindingId: "AB-000003",
    } as never);

    await updateAuthorityBinding("AB-000003", {
      name: "Finance workspace controller",
      subjects: [{ subjectType: "platform-role", subjectRef: "HR-401", relation: "allowed" }],
    });

    expect(prisma.authorityBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bindingId: "AB-000003" },
        data: expect.not.objectContaining({
          appliedAgentId: null,
        }),
      }),
    );
  });
});
