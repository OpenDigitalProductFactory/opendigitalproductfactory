import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    employeeProfile: {
      findUnique: vi.fn(),
    },
    agent: {
      findUnique: vi.fn(),
    },
    customerContact: {
      findUnique: vi.fn(),
    },
    principal: {
      create: vi.fn(),
      update: vi.fn(),
    },
    principalAlias: {
      findFirst: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  PrincipalAliasConflictError,
  resolvePrincipalRecordIdForSessionIdentity,
  syncAgentPrincipal,
  syncCustomerPrincipal,
  syncEmployeePrincipal,
  syncUserPrincipal,
} from "./principal-linking";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncUserPrincipal", () => {
  it("creates the installation owner principal cleared through confidential", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "owner-user",
      email: "owner@example.com",
      isActive: true,
      isSuperuser: true,
      employeeProfile: null,
    } as never);
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.principal.create).mockResolvedValue({
      id: "principal-owner",
      principalId: "PRN-owner",
      kind: "human",
      status: "active",
      displayName: "owner@example.com",
      sensitivityClearance: ["public", "internal"],
    } as never);
    vi.mocked(prisma.principalAlias.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([]);

    await syncUserPrincipal("owner-user");

    expect(prisma.principal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "human",
        sensitivityClearance: ["public", "internal", "confidential"],
      }),
    });
  });
});

describe("syncEmployeePrincipal", () => {
  it("creates a human principal anchored by employee and user aliases", async () => {
    vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue({
      id: "emp-db-1",
      employeeId: "EMP-001",
      userId: "user-1",
      displayName: "Ada Lovelace",
      workEmail: "ada@example.com",
    } as never);
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.principal.create).mockResolvedValue({
      id: "principal-db-1",
      principalId: "PRN-000001",
      kind: "human",
      status: "active",
      displayName: "Ada Lovelace",
      sponsorPrincipalId: null,
      authorityMode: null,
      preferredLanguage: null,
      timeZone: null,
      sensitivityClearance: ["public"],
      createdAt: new Date("2026-04-23T00:00:00Z"),
      updatedAt: new Date("2026-04-23T00:00:00Z"),
    });
    vi.mocked(prisma.principalAlias.createMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
      {
        id: "alias-employee",
        principalId: "principal-db-1",
        aliasType: "employee",
        aliasValue: "EMP-001",
        issuer: "",
        createdAt: new Date("2026-04-23T00:00:00Z"),
      },
      {
        id: "alias-user",
        principalId: "principal-db-1",
        aliasType: "user",
        aliasValue: "user-1",
        issuer: "",
        createdAt: new Date("2026-04-23T00:00:00Z"),
      },
    ]);

    const result = await syncEmployeePrincipal("emp-db-1");

    expect(result.kind).toBe("human");
    expect(result.principalId).toBe("PRN-000001");
    expect(result.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ aliasType: "employee", aliasValue: "EMP-001" }),
        expect.objectContaining({ aliasType: "user", aliasValue: "user-1" }),
      ]),
    );
  });
});

describe("syncAgentPrincipal", () => {
  it("creates an agent principal with agent and GAID aliases for AI workforce identities", async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: "agent-db-1",
      agentId: "AGT-100",
      name: "Finance Specialist",
      status: "active",
    } as never);
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.principal.create).mockResolvedValue({
      id: "principal-db-2",
      principalId: "PRN-000002",
      kind: "agent",
      status: "active",
      displayName: "Finance Specialist",
      sponsorPrincipalId: null,
      authorityMode: null,
      preferredLanguage: null,
      timeZone: null,
      sensitivityClearance: ["public"],
      createdAt: new Date("2026-04-23T00:00:00Z"),
      updatedAt: new Date("2026-04-23T00:00:00Z"),
    });
    vi.mocked(prisma.principalAlias.createMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
      {
        id: "alias-agent",
        principalId: "principal-db-2",
        aliasType: "agent",
        aliasValue: "AGT-100",
        issuer: "",
        createdAt: new Date("2026-04-23T00:00:00Z"),
      },
      {
        id: "alias-gaid",
        principalId: "principal-db-2",
        aliasType: "gaid",
        aliasValue: "gaid:priv:dpf.internal:agt-100",
        issuer: "",
        createdAt: new Date("2026-04-23T00:00:00Z"),
      },
    ]);

    const result = await syncAgentPrincipal("AGT-100");

    expect(result.kind).toBe("agent");
    expect(result.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ aliasType: "agent", aliasValue: "AGT-100" }),
        expect.objectContaining({
          aliasType: "gaid",
          aliasValue: "gaid:priv:dpf.internal:agt-100",
        }),
      ]),
    );
  });
});

describe("syncCustomerPrincipal", () => {
  it("creates a customer principal anchored by customer_contact and lowercase email aliases", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue({
      id: "contact-db-1",
      email: "Buyer@Example.com",
      isActive: true,
      mergedIntoId: null,
      account: { status: "active", partnerEnrollment: null },
    } as never);
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.principal.create).mockResolvedValue({
      id: "principal-db-3",
      principalId: "PRN-000003",
      kind: "customer",
      status: "active",
      displayName: "Buyer@Example.com",
      sponsorPrincipalId: null,
      authorityMode: null,
      preferredLanguage: null,
      timeZone: null,
      sensitivityClearance: ["public"],
      createdAt: new Date("2026-04-26T00:00:00Z"),
      updatedAt: new Date("2026-04-26T00:00:00Z"),
    });
    vi.mocked(prisma.principalAlias.createMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
      {
        id: "alias-customer-contact",
        principalId: "principal-db-3",
        aliasType: "customer_contact",
        aliasValue: "contact-db-1",
        issuer: "",
        createdAt: new Date("2026-04-26T00:00:00Z"),
      },
      {
        id: "alias-email",
        principalId: "principal-db-3",
        aliasType: "email",
        aliasValue: "buyer@example.com",
        issuer: "",
        createdAt: new Date("2026-04-26T00:00:00Z"),
      },
    ]);

    const result = await syncCustomerPrincipal("contact-db-1");

    expect(result.kind).toBe("customer");
    expect(result.principalId).toBe("PRN-000003");
    expect(result.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aliasType: "customer_contact",
          aliasValue: "contact-db-1",
        }),
        expect.objectContaining({
          aliasType: "email",
          aliasValue: "buyer@example.com",
        }),
      ]),
    );
  });

  it("marks the principal inactive when the contact is inactive", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue({
      id: "contact-db-2",
      email: "former@example.com",
      isActive: false,
      mergedIntoId: null,
      account: { status: "active", partnerEnrollment: null },
    } as never);
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.principal.create).mockResolvedValue({
      id: "principal-db-4",
      principalId: "PRN-000004",
      kind: "customer",
      status: "inactive",
      displayName: "former@example.com",
      sponsorPrincipalId: null,
      authorityMode: null,
      preferredLanguage: null,
      timeZone: null,
      sensitivityClearance: ["public"],
      createdAt: new Date("2026-04-26T00:00:00Z"),
      updatedAt: new Date("2026-04-26T00:00:00Z"),
    });
    vi.mocked(prisma.principalAlias.createMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([]);

    const result = await syncCustomerPrincipal("contact-db-2");

    expect(result.status).toBe("inactive");
  });

  it("throws when the customer contact does not exist", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue(null);
    await expect(syncCustomerPrincipal("missing-contact")).rejects.toThrow(
      /CustomerContact missing-contact not found/,
    );
  });

  it("derives partner kind and both canonical contact aliases from live enrollment", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue({
      id: "contact-partner",
      email: "Partner@Example.com",
      isActive: true,
      mergedIntoId: null,
      account: {
        status: "active",
        partnerEnrollment: { status: "active", endedAt: null },
      },
    } as never);
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.principal.create).mockResolvedValue({
      id: "principal-partner",
      principalId: "PRN-partner",
      kind: "partner",
      status: "active",
      displayName: "Partner@Example.com",
      sensitivityClearance: ["public"],
    } as never);
    vi.mocked(prisma.principalAlias.createMany).mockResolvedValue({ count: 3 });
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
      { principalId: "principal-partner", aliasType: "customer_contact", aliasValue: "contact-partner", issuer: "" },
      { principalId: "principal-partner", aliasType: "partner_contact", aliasValue: "contact-partner", issuer: "" },
      { principalId: "principal-partner", aliasType: "email", aliasValue: "partner@example.com", issuer: "" },
    ] as never);

    const result = await syncCustomerPrincipal("contact-partner");

    expect(result.kind).toBe("partner");
    expect(result.aliases.map((alias) => alias.aliasType).sort()).toEqual([
      "customer_contact",
      "email",
      "partner_contact",
    ]);
  });

  it("refuses aliases already split across two Principals", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue({
      id: "contact-conflict",
      email: "conflict@example.com",
      isActive: true,
      mergedIntoId: null,
      account: { status: "active", partnerEnrollment: null },
    } as never);
    vi.mocked(prisma.principalAlias.findFirst)
      .mockResolvedValueOnce({ principal: {
        id: "principal-a", principalId: "PRN-a", kind: "customer", status: "active",
        displayName: "A", sensitivityClearance: ["public"],
      } } as never)
      .mockResolvedValueOnce({ principal: {
        id: "principal-b", principalId: "PRN-b", kind: "customer", status: "active",
        displayName: "B", sensitivityClearance: ["public"],
      } } as never);

    await expect(syncCustomerPrincipal("contact-conflict")).rejects.toBeInstanceOf(
      PrincipalAliasConflictError,
    );
    expect(prisma.principal.update).not.toHaveBeenCalled();
    expect(prisma.principal.create).not.toHaveBeenCalled();
  });
});

describe("resolvePrincipalRecordIdForSessionIdentity", () => {
  it.each([
    ["admin", "user-1", "user"],
    ["customer", "contact-1", "customer_contact"],
  ] as const)("resolves the relational principal for %s sessions", async (type, id, aliasType) => {
    vi.mocked(prisma.principalAlias.findFirst).mockResolvedValue({
      principal: { id: "principal-db-1" },
    } as never);

    await expect(
      resolvePrincipalRecordIdForSessionIdentity({ type, id }),
    ).resolves.toBe("principal-db-1");
    expect(prisma.principalAlias.findFirst).toHaveBeenCalledWith({
      where: { aliasType, aliasValue: id, issuer: "" },
      include: { principal: { select: { id: true } } },
    });
  });
});
