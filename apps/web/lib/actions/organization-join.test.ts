import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertEncryptionReady,
  mockAuth,
  mockCan,
  mockCancel,
  mockConsume,
  mockCreateAction,
  mockPrisma,
  mockRevalidatePath,
  mockSyncUserPrincipal,
  tx,
} = vi.hoisted(() => {
  const transactionClient = {
    changeRequest: { create: vi.fn() },
  };
  return {
    mockAssertEncryptionReady: vi.fn(),
    mockAuth: vi.fn(),
    mockCan: vi.fn(),
    mockCancel: vi.fn(),
    mockConsume: vi.fn(),
    mockCreateAction: vi.fn(),
    mockRevalidatePath: vi.fn(),
    mockSyncUserPrincipal: vi.fn(),
    tx: transactionClient,
    mockPrisma: {
      principalAlias: { findFirst: vi.fn() },
      employeeProfile: { findUnique: vi.fn() },
      edgeNode: { findMany: vi.fn() },
      remoteAction: { findUnique: vi.fn() },
      $transaction: vi.fn(async (callback: (client: typeof transactionClient) => unknown) => callback(transactionClient)),
    },
  };
});

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/lib/change-management/lifecycle", () => ({ makeRfcId: () => "RFC-JOIN-1" }));
vi.mock("@/lib/govern/credential-crypto", () => ({
  assertEncryptionReadyForCredentialWrite: mockAssertEncryptionReady,
}));
vi.mock("@/lib/identity/principal-linking", () => ({ syncUserPrincipal: mockSyncUserPrincipal }));
vi.mock("@/lib/remote-action/organization-join-actions", () => ({
  cancelQueuedOrganizationJoinAction: mockCancel,
  consumeIssuedJoinPackage: mockConsume,
  createOrganizationJoinAction: mockCreateAction,
}));

import {
  getOrganizationJoinActionStatusAction,
  getOrganizationJoinNodeSummariesAction,
  queueOrganizationJoinActionAction,
} from "./organization-join";

const ADMIN = { user: { id: "user-1", platformRole: "HR-000", isSuperuser: false } };

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue(ADMIN);
  mockCan.mockReturnValue(true);
  mockPrisma.principalAlias.findFirst.mockResolvedValue({ principalId: "principal-1" });
  mockPrisma.employeeProfile.findUnique.mockResolvedValue({ id: "employee-1" });
  tx.changeRequest.create.mockResolvedValue({ id: "change-1" });
  mockCreateAction.mockResolvedValue({ ok: true, actionKey: "ra-join-1" });
  mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx));
});

describe("organization join action boundary", () => {
  it("rejects an unauthenticated caller before reading host state", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await getOrganizationJoinNodeSummariesAction();

    expect(result).toEqual({ ok: false, error: "unauthorized", message: "Sign in required" });
    expect(mockPrisma.edgeNode.findMany).not.toHaveBeenCalled();
  });

  it("reports only role-correct, trusted, allow-listed installations as ready", async () => {
    mockPrisma.edgeNode.findMany.mockResolvedValue([
      {
        id: "edge-row-1",
        nodeId: "edge-1",
        platform: "darwin",
        status: "online",
        trustState: "trusted",
        scopePolicy: { actionTypes: ["organization.join.issue"] },
        principal: { displayName: "Founder Hub" },
        capabilityRows: [{ mode: "enabled", status: "online", evidence: { organizationTrustRole: "authority" } }],
      },
      {
        id: "edge-row-2",
        nodeId: "edge-2",
        platform: "windows",
        status: "online",
        trustState: "trusted",
        scopePolicy: { actionTypes: ["inventory.collect"] },
        principal: { displayName: "Windows test" },
        capabilityRows: [{ mode: "enabled", status: "online", evidence: { organizationTrustRole: "member" } }],
      },
    ]);

    const result = await getOrganizationJoinNodeSummariesAction();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nodes[0]).toMatchObject({ displayName: "Founder Hub", actionType: "organization.join.issue", ready: true });
      expect(result.nodes[1]).toMatchObject({ displayName: "Windows test", actionType: "organization.join.import", ready: false });
    }
  });

  it("creates the approved high-risk change anchor and action atomically", async () => {
    const input = {
      actionType: "organization.join.issue" as const,
      edgeNodeId: "edge-row-1",
      parameters: { intendedPeer: "windows-dev.local", ttlSeconds: 600 },
      operatorConfirmed: true,
    };

    const result = await queueOrganizationJoinActionAction(input);

    expect(result).toEqual({ ok: true, actionKey: "ra-join-1" });
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.changeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rfcId: "RFC-JOIN-1",
        riskLevel: "high",
        status: "approved",
        approvedById: "employee-1",
        postChangeVerification: {
          certificateTrust: true,
          overlayPersistence: true,
          portalHealth: true,
          edgeHeartbeat: true,
        },
      }),
      select: { id: true },
    });
    expect(mockCreateAction).toHaveBeenCalledWith(tx, expect.objectContaining({
      changeRequestId: "change-1",
      requestedByPrincipalId: "principal-1",
      operatorConfirmed: true,
    }));
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/federation-links");
  });

  it("checks credential encryption before creating an import change", async () => {
    mockAssertEncryptionReady.mockRejectedValue(new Error("missing key"));

    const result = await queueOrganizationJoinActionAction({
      actionType: "organization.join.import",
      edgeNodeId: "edge-row-2",
      parameters: { joinPackage: "sensitive" },
      operatorConfirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "not_ready",
      message: "Secure credential storage is not configured",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns a safe failure while causing the transaction to roll back on a governance rejection", async () => {
    mockCreateAction.mockResolvedValue({ ok: false, reason: "wrong-host-role" });

    const result = await queueOrganizationJoinActionAction({
      actionType: "organization.join.issue",
      edgeNodeId: "edge-row-2",
      parameters: { intendedPeer: "windows-dev.local", ttlSeconds: 600 },
      operatorConfirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "not_ready",
      message: "This installation cannot perform that organization setup step",
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("never returns encrypted package material or sensitive evidence in status", async () => {
    mockPrisma.remoteAction.findUnique.mockResolvedValue({
      actionKey: "ra-join-1",
      actionType: "organization.join.issue",
      status: "succeeded",
      approvalState: "approved",
      result: { joinPackageEnc: "enc:iv:tag:cipher" },
      evidence: {
        portalHealth: true,
        nested: { edgeHeartbeat: true, enrollmentToken: "must-not-escape" },
        joinPackage: "must-not-escape",
      },
    });

    const result = await getOrganizationJoinActionStatusAction("ra-join-1");

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      packageReady: true,
      evidence: { portalHealth: true, nested: { edgeHeartbeat: true } },
    }));
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(JSON.stringify(result)).not.toContain("enc:iv:tag:cipher");
  });
});
