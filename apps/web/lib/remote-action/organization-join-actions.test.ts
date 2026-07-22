import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  consumeIssuedJoinPackage,
  cancelQueuedOrganizationJoinAction,
  createOrganizationJoinAction,
  type OrganizationJoinActionDb,
} from "./organization-join-actions";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const PACKAGE = [
  "DPF_ORGANIZATION_JOIN_V2",
  "package_id=0123456789abcdef0123456789abcdef",
  "ca_url=https://founder-hub.local:9000",
  `root_fingerprint=${"A".repeat(64)}`,
  "intended_hostname=windows-dev.local",
  "intended_sans=windows-dev.local,192.168.1.42",
  `expires_at=${Math.floor(NOW.getTime() / 1000) + 600}`,
  "enrollment_token=token-safe_123",
  "edge_client_enrollment_token=edge-safe_456",
  "",
].join("\n");

function node(role: "authority" | "member", allowed = true) {
  return {
    id: "node-row-1",
    nodeId: "edge_1",
    trustState: "trusted",
    customerAccountId: null,
    customerSiteId: null,
    metadata: { hostname: role === "authority" ? "founder-hub.local" : "windows-dev.local" },
    scopePolicy: {
      actionTypes: allowed
        ? [role === "authority" ? "organization.join.issue" : "organization.join.import"]
        : ["inventory.collect"],
    },
    capabilityRows: [{
      capability: "action.execute",
      mode: "enabled",
      evidence: { organizationTrustRole: role },
    }],
  };
}

const approvedChange = {
  id: "change-1",
  status: "approved",
  approvedAt: NOW,
  approvedById: "employee-approver",
  impactReport: {
    edgeNodeId: "node-row-1",
    actionType: "organization.join.issue",
    operatorConfirmation: true,
    impact: "organization trust changes",
  },
  postChangeVerification: {
    certificateTrust: true,
    overlayPersistence: true,
    portalHealth: true,
    edgeHeartbeat: true,
  },
  changeItems: [{ rollbackPlan: "Restore the pre-action trust overlay snapshot." }],
};

function dbFixture(options: {
  role?: "authority" | "member";
  allowed?: boolean;
  change?: typeof approvedChange | null;
  duplicate?: boolean;
} = {}) {
  const create = vi.fn().mockResolvedValue({ actionKey: "ra_join_1" });
  const findFirst = vi.fn().mockResolvedValue(options.duplicate ? { actionKey: "ra_existing" } : null);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const findUniqueAction = vi.fn();
  const change = options.change === undefined
    ? {
        ...approvedChange,
        impactReport: {
          ...approvedChange.impactReport,
          actionType: options.role === "member" ? "organization.join.import" : "organization.join.issue",
        },
      }
    : options.change;
  const findUniqueChange = vi.fn().mockResolvedValue(change);
  const db = {
    edgeNode: { findUnique: vi.fn().mockResolvedValue(node(options.role ?? "authority", options.allowed ?? true)) },
    changeRequest: { findUnique: findUniqueChange },
    remoteAction: { create, findFirst, findUnique: findUniqueAction, updateMany },
  } as unknown as OrganizationJoinActionDb;
  return { db, create, findFirst, findUniqueAction, findUniqueChange, updateMany };
}

describe("createOrganizationJoinAction", () => {
  it("creates an approved, machine-bound issue action only after all governance gates pass", async () => {
    const { db, create } = dbFixture({ role: "authority" });
    const result = await createOrganizationJoinAction(db, {
      actionType: "organization.join.issue",
      edgeNodeId: "node-row-1",
      changeRequestId: "change-1",
      requestedByPrincipalId: "principal-operator",
      operatorConfirmed: true,
      parameters: { intendedPeer: "windows-dev.local", ttlSeconds: 600 },
    }, { now: NOW, actionKeyFactory: () => "ra_join_1", encryptSecret: (value) => `enc:${value}` });

    expect(result).toEqual({ ok: true, actionKey: "ra_join_1" });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actionType: "organization.join.issue",
      edgeNodeId: "node-row-1",
      riskClass: "high",
      approvalState: "approved",
      approvedByPrincipalId: "principal-operator",
      changeRequestId: "change-1",
      parameters: { intendedPeer: "windows-dev.local", ttlSeconds: 600 },
      status: "queued",
    }) });
  });

  it("encrypts an import package, stores only its digest/preview, and binds it to the member node", async () => {
    const { db, create, findFirst } = dbFixture({ role: "member" });
    const result = await createOrganizationJoinAction(db, {
      actionType: "organization.join.import",
      edgeNodeId: "node-row-1",
      changeRequestId: "change-1",
      requestedByPrincipalId: "principal-operator",
      operatorConfirmed: true,
      parameters: { joinPackage: PACKAGE },
    }, { now: NOW, actionKeyFactory: () => "ra_join_1", encryptSecret: () => "enc:iv:tag:cipher" });

    expect(result).toEqual({ ok: true, actionKey: "ra_join_1" });
    const digest = createHash("sha256").update(PACKAGE).digest("hex");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ actionType: "organization.join.import" }),
    }));
    const data = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.parameters).toEqual({ joinPackageEnc: "enc:iv:tag:cipher" });
    expect(data.evidence).toEqual(expect.objectContaining({
      packageDigest: digest,
      intendedPeer: "windows-dev.local",
      expiresAt: "2026-07-22T10:10:00.000Z",
    }));
    expect(JSON.stringify(data)).not.toContain("token-safe_123");
  });

  it("fails closed for missing confirmation, role mismatch, allowlist, change approval, recovery, or replay", async () => {
    const base = {
      actionType: "organization.join.issue" as const,
      edgeNodeId: "node-row-1",
      changeRequestId: "change-1",
      requestedByPrincipalId: "principal-operator",
      operatorConfirmed: true,
      parameters: { intendedPeer: "windows-dev.local", ttlSeconds: 600 },
    };
    const cases: Array<[OrganizationJoinActionDb, typeof base, string]> = [
      [dbFixture().db, { ...base, operatorConfirmed: false }, "operator-confirmation-required"],
      [dbFixture({ role: "member" }).db, base, "wrong-host-role"],
      [dbFixture({ allowed: false }).db, base, "action-not-allowlisted"],
      [dbFixture({ change: { ...approvedChange, status: "draft" } }).db, base, "approved-change-request-required"],
      [dbFixture({ change: { ...approvedChange, impactReport: { ...approvedChange.impactReport, edgeNodeId: "another-node" } } }).db, base, "impact-report-required"],
      [dbFixture({ change: { ...approvedChange, changeItems: [{ rollbackPlan: null }] } as never }).db, base, "recovery-plan-required"],
      [dbFixture({ change: { ...approvedChange, postChangeVerification: { ...approvedChange.postChangeVerification, portalHealth: false } } }).db, base, "post-change-verification-required"],
    ];
    for (const [db, input, reason] of cases) {
      expect(await createOrganizationJoinAction(db, input, { now: NOW, encryptSecret: (v) => `enc:${v}` })).toEqual({ ok: false, reason });
    }

    const replay = dbFixture({ role: "member", duplicate: true });
    expect(await createOrganizationJoinAction(replay.db, {
      ...base,
      actionType: "organization.join.import",
      parameters: { joinPackage: PACKAGE },
    }, { now: NOW, encryptSecret: () => "enc:iv:tag:cipher" })).toEqual({ ok: false, reason: "join-package-already-used" });
  });

  it("refuses import when the encryption boundary would store plaintext", async () => {
    const { db, create } = dbFixture({ role: "member" });
    const result = await createOrganizationJoinAction(db, {
      actionType: "organization.join.import",
      edgeNodeId: "node-row-1",
      changeRequestId: "change-1",
      requestedByPrincipalId: "principal-operator",
      operatorConfirmed: true,
      parameters: { joinPackage: PACKAGE },
    }, { now: NOW, encryptSecret: (value) => value });
    expect(result).toEqual({ ok: false, reason: "credential-encryption-unavailable" });
    expect(create).not.toHaveBeenCalled();
  });

  it("uses the package digest as a uniqueness backstop against concurrent import replay", async () => {
    const { db, create, findFirst } = dbFixture({ role: "member" });
    findFirst.mockResolvedValue(null);
    create.mockRejectedValue({ code: "P2002" });

    const result = await createOrganizationJoinAction(db, {
      actionType: "organization.join.import",
      edgeNodeId: "node-row-1",
      changeRequestId: "change-1",
      requestedByPrincipalId: "principal-operator",
      operatorConfirmed: true,
      parameters: { joinPackage: PACKAGE },
    }, { now: NOW, encryptSecret: () => "enc:iv:tag:cipher" });

    expect(result).toEqual({ ok: false, reason: "join-package-already-used" });
    expect(create.mock.calls[0]![0].data.actionKey).toMatch(/^ra_join_import_[a-f0-9]{64}$/);
  });
});

describe("consumeIssuedJoinPackage", () => {
  it("returns an issued package once and atomically clears the encrypted material", async () => {
    const { db, findUniqueAction, updateMany } = dbFixture();
    findUniqueAction.mockResolvedValue({
      actionKey: "ra_join_1",
      actionType: "organization.join.issue",
      status: "succeeded",
      result: { joinPackageEnc: "enc:iv:tag:cipher", expiresAt: "2026-07-22T10:10:00.000Z" },
    });
    const result = await consumeIssuedJoinPackage(db, "ra_join_1", {
      now: NOW,
      decryptSecret: () => PACKAGE,
    });
    expect(result).toEqual({ ok: true, joinPackage: PACKAGE, expiresAt: new Date("2026-07-22T10:10:00.000Z") });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ actionKey: "ra_join_1", status: "succeeded" }),
      data: { result: { expiresAt: "2026-07-22T10:10:00.000Z", downloadedAt: NOW.toISOString() } },
    });
  });

  it("does not disclose expired, consumed, failed-decryption, or non-issue results", async () => {
    const { db, findUniqueAction } = dbFixture();
    for (const [row, reason] of [
      [{ actionKey: "ra", actionType: "organization.join.issue", status: "succeeded", result: { expiresAt: NOW.toISOString(), downloadedAt: NOW.toISOString() } }, "join-package-consumed"],
      [{ actionKey: "ra", actionType: "organization.join.issue", status: "succeeded", result: { joinPackageEnc: "enc:x", expiresAt: "2026-07-22T09:59:59.000Z" } }, "join-package-expired"],
      [{ actionKey: "ra", actionType: "organization.join.import", status: "succeeded", result: {} }, "join-package-not-available"],
    ] as const) {
      findUniqueAction.mockResolvedValue(row);
      expect(await consumeIssuedJoinPackage(db, "ra", { now: NOW, decryptSecret: () => null })).toEqual({ ok: false, reason });
    }
  });
});

describe("cancelQueuedOrganizationJoinAction", () => {
  it("cancels only a not-yet-dispatched join action and clears package material", async () => {
    const { db, findUniqueAction, updateMany } = dbFixture();
    findUniqueAction.mockResolvedValue({ actionKey: "ra", actionType: "organization.join.import", status: "queued", result: {} });
    expect(await cancelQueuedOrganizationJoinAction(db, "ra", { now: NOW })).toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { actionKey: "ra", status: "queued" },
      data: expect.objectContaining({
        status: "failed",
        approvalState: "cancelled",
        parameters: { clearedAt: NOW.toISOString() },
        result: {},
      }),
    });
  });
});
