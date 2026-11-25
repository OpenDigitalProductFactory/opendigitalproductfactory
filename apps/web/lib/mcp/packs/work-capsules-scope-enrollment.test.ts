import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  $executeRawUnsafe: vi.fn(),
  authorizationDecisionLog: { findUnique: vi.fn() },
  workroom: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  workroomActivity: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: mockPrisma,
}));

// These tool fixtures represent a qualified canonical writer cohort.
vi.mock("@/lib/work-capsules/scope-epoch-enrollment.server", async original => ({
  ...await original<typeof import("@/lib/work-capsules/scope-epoch-enrollment.server")>(),
  assertScopeEpochEnrollmentReady: vi.fn(async () => ({ assertCurrent() {} })),
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  ensureAgentPrincipalIdentity: vi.fn(async () => ({ id: "principal-agent" })),
  syncUserPrincipal: vi.fn(async () => ({ id: "principal-user" })),
}));

describe("Workroom scope enrollment refusals over MCP", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([undefined, "diagnostic-claim"])("claim_workroom_scope surfaces safe recovery without writing (commandId %s)", async commandId => {
    mockPrisma.workroom.findUnique.mockResolvedValue({
      id: "row-1", capsuleId: "WC-SCOPE", status: "working", archivedAt: null, updatedAt: new Date(),
      leaseHolderPrincipalId: "principal-agent", leaseExpiresAt: new Date(Date.now() + 600_000), scopeClaims: [],
    });
    const { assertScopeEpochEnrollmentReady } = await import("@/lib/work-capsules/scope-epoch-enrollment.server");
    const actual = await vi.importActual<typeof import("@/lib/work-capsules/scope-epoch-enrollment.server")>("@/lib/work-capsules/scope-epoch-enrollment.server");
    vi.mocked(assertScopeEpochEnrollmentReady).mockImplementationOnce(() => actual.assertScopeEpochEnrollmentReady({
      readFile: async path => { throw Object.assign(new Error(`internal path ${path}: secret content`), { code: "ENOENT" }); },
      attachRetirement: async () => ({ status: "unavailable" }), readRun: async () => null, now: () => new Date(),
      runDocker: async () => { throw new Error("Docker should not be needed"); },
    }));
    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("claim_workroom_scope", {
      capsuleId: "WC-SCOPE", commandId,
      claims: [{ kind: "path", value: "apps/web/lib/work-capsules.ts", intent: "edit" }],
    }, "user-1", { agentId: "codex" });

    expect(result).toMatchObject({
      success: false, error: "scope_claim_precondition_failed",
      data: { reason: { kind: "canonical-writer-evidence-unavailable", step: "read-process-cgroup", code: "ENOENT" } },
      message: "scope-epoch-enrollment-held:canonical-writer-evidence-unavailable:read-process-cgroup:ENOENT. Probe error: report this reason to the installation operator.",
    });
    expect(result.message).not.toMatch(/\/proc\/self|secret content/);
    expect(mockPrisma.workroom.update).not.toHaveBeenCalled();
    expect(mockPrisma.workroomActivity.create).not.toHaveBeenCalled();
  });
});
