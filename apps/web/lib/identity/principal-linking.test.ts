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
import { syncAgentPrincipal, syncEmployeePrincipal } from "./principal-linking";

beforeEach(() => {
  vi.clearAllMocks();
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
