import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// Relative source import keeps this source-local test runnable in an isolated
// worktree before workspace dependency links are converged by the shared gate.
import { signEdgeActionEnvelope, verifyEdgeActionEnvelope } from "../../../../packages/db/src/edge-action-envelope";

import {
  claimActionsForNode,
  clearExpiredJoinPackageMaterial,
  recordActionResult,
  timeoutStaleClaims,
  type ClaimableActionRow,
  type DispatchOrchestratorDb,
} from "./dispatch-orchestrator";

const NOW = new Date("2026-06-25T20:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const NONCE = "nonce_0123456789abcdef";
const signer = {
  signingKeyId: "edge-action-signing-v1",
  sign: (envelope: Parameters<typeof signEdgeActionEnvelope>[0]) => signEdgeActionEnvelope(envelope, privateKey),
};

function candidate(over: Partial<ClaimableActionRow> = {}): ClaimableActionRow {
  return {
    actionKey: "ra_1",
    actionType: "diagnostics.collect",
    riskClass: "read-only",
    approvalState: "approved",
    status: "queued",
    customerAccountId: null,
    customerSiteId: null,
    edgeNodeId: null,
    changeRequestId: null,
    parameters: { probe: "iface" },
    ...over,
  };
}

const trustedInternalNode = {
  edgeNodeId: "node_1",
  nodeId: "edge_external_1",
  trustState: "trusted",
  customerAccountId: null,
  customerSiteId: null,
  actionExecuteEnabled: true,
  allowedActionTypes: ["diagnostics.collect", "inventory.collect"],
  organizationTrustRole: "member" as const,
};

const claimOptions = { now: NOW, signer, nonceFactory: () => NONCE };

function claimDb(candidates: ClaimableActionRow[], updateCount = 1) {
  const findMany = vi.fn().mockResolvedValue(candidates);
  const updateMany = vi.fn().mockResolvedValue({ count: updateCount });
  return {
    db: {
      remoteAction: { findMany, updateMany, findUnique: vi.fn(), update: vi.fn() },
      changeRequest: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as DispatchOrchestratorDb,
    findMany,
    updateMany,
  };
}

describe("claimActionsForNode", () => {
  it("scenario INTERNAL: claims an internal queued read-only action", async () => {
    const { db, updateMany } = claimDb([candidate()]);
    const res = await claimActionsForNode(db, trustedInternalNode, claimOptions);
    expect(res.claimed).toHaveLength(1);
    expect(verifyEdgeActionEnvelope(res.claimed[0]!, { publicKey, expectedNodeId: "edge_external_1", now: NOW })).toEqual({ ok: true, nonce: NONCE });
    expect(res.claimed[0]).toMatchObject({ actionKey: "ra_1", actionType: "diagnostics.collect", parameters: { probe: "iface" } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { actionKey: "ra_1", status: "queued" },
      data: expect.objectContaining({
        status: "claimed",
        edgeNodeId: "node_1",
        startedAt: NOW,
        dispatchNonce: NONCE,
        dispatchIssuedAt: NOW,
        dispatchSigningKeyId: "edge-action-signing-v1",
      }),
    });
  });

  it("scenario IT-MSP CUSTOMER: claims own customer's action, never another tenant's", async () => {
    const custNode = { ...trustedInternalNode, customerAccountId: "cust1" };
    // findMany is account-scoped; eligibility re-checks. Include a stray other-tenant row to prove the gate.
    const { db } = claimDb([
      candidate({ actionKey: "mine", customerAccountId: "cust1" }),
      candidate({ actionKey: "other", customerAccountId: "cust2" }),
    ]);
    const res = await claimActionsForNode(db, custNode, claimOptions);
    expect(res.claimed.map((c) => c.actionKey)).toEqual(["mine"]);
  });

  it("claims nothing for an untrusted or capability-disabled node (no DB read)", async () => {
    const { db, findMany } = claimDb([candidate()]);
    expect((await claimActionsForNode(db, { ...trustedInternalNode, actionExecuteEnabled: false }, claimOptions)).claimed).toEqual([]);
    expect((await claimActionsForNode(db, { ...trustedInternalNode, trustState: "quarantined" }, claimOptions)).claimed).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("loses the single-claim race gracefully (updateMany count 0 → skipped)", async () => {
    const { db } = claimDb([candidate()], 0);
    const res = await claimActionsForNode(db, trustedInternalNode, claimOptions);
    expect(res).toEqual({ claimed: [], skipped: 1 });
  });

  it("a mutating candidate is filtered out by the eligibility gate (never claimed)", async () => {
    const { db, updateMany } = claimDb([candidate({ riskClass: "medium", actionType: "service.restart" })]);
    const res = await claimActionsForNode(db, trustedInternalNode, claimOptions);
    expect(res.claimed).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("claims an approved import for a member and decrypts package material only into the signed envelope", async () => {
    const PACKAGE = [
      "DPF_ORGANIZATION_JOIN_V2",
      "package_id=0123456789abcdef0123456789abcdef",
      "ca_url=https://founder-hub.local:9000",
      `root_fingerprint=${"A".repeat(64)}`,
      "intended_hostname=windows-dev.local",
      "intended_sans=windows-dev.local",
      `expires_at=${Math.floor(NOW.getTime() / 1000) + 600}`,
      "enrollment_token=token-safe_123",
      "edge_client_enrollment_token=edge-safe_456",
      "",
    ].join("\n");
    const row = candidate({
      actionType: "organization.join.import",
      riskClass: "high",
      edgeNodeId: "node_1",
      changeRequestId: "change-1",
      parameters: { joinPackageEnc: "enc:iv:tag:cipher" },
    });
    const { db } = claimDb([row]);
    vi.mocked(db.changeRequest!.findMany).mockResolvedValue([{ id: "change-1", status: "approved", approvedAt: NOW, approvedById: "employee-1" }]);
    const result = await claimActionsForNode(db, {
      ...trustedInternalNode,
      organizationTrustRole: "member",
      allowedActionTypes: ["organization.join.import"],
    }, { ...claimOptions, decryptSecret: () => PACKAGE });
    expect(result.claimed).toHaveLength(1);
    expect(result.claimed[0]?.parameters).toEqual({ joinPackage: PACKAGE });
    expect(JSON.stringify(row.parameters)).not.toContain("token-safe_123");
  });
});

function resultDb(row: { actionKey: string; status: string; edgeNodeId: string | null } | null) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const update = vi.fn().mockResolvedValue({});
  return {
    db: {
      remoteAction: { findUnique, update, findMany: vi.fn(), updateMany: vi.fn() },
      changeRequest: { findMany: vi.fn() },
    } as unknown as DispatchOrchestratorDb,
    update,
  };
}

describe("recordActionResult", () => {
  it("the owning node reports success: terminal + evidence + completedAt", async () => {
    const { db, update } = resultDb({ actionKey: "ra_1", status: "claimed", edgeNodeId: "node_1" });
    const res = await recordActionResult(db, { actionKey: "ra_1", edgeNodeRowId: "node_1", outcome: "succeeded", evidence: { lines: 3 } }, { now: NOW });
    expect(res).toEqual({ ok: true, status: "succeeded" });
    const data = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.status).toBe("succeeded");
    expect(data.completedAt).toBe(NOW);
    expect((data.evidence as Record<string, unknown>).reportedByNode).toBe("node_1");
  });

  it("rejects a report from a node that does not own the claim", async () => {
    const { db, update } = resultDb({ actionKey: "ra_1", status: "claimed", edgeNodeId: "node_1" });
    const res = await recordActionResult(db, { actionKey: "ra_1", edgeNodeRowId: "node_2", outcome: "succeeded" });
    expect(res).toEqual({ ok: false, reason: "not-claimed-by-this-node" });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition (queued→succeeded)", async () => {
    const { db } = resultDb({ actionKey: "ra_1", status: "queued", edgeNodeId: "node_1" });
    const res = await recordActionResult(db, { actionKey: "ra_1", edgeNodeRowId: "node_1", outcome: "succeeded" });
    expect(res.ok).toBe(false);
  });

  it("a running heartbeat is not terminal (no completedAt)", async () => {
    const { db, update } = resultDb({ actionKey: "ra_1", status: "claimed", edgeNodeId: "node_1" });
    const res = await recordActionResult(db, { actionKey: "ra_1", edgeNodeRowId: "node_1", outcome: "running" }, { now: NOW });
    expect(res).toEqual({ ok: true, status: "running" });
    const data = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.completedAt).toBeUndefined();
  });

  it("not-found is reported", async () => {
    const { db } = resultDb(null);
    expect(await recordActionResult(db, { actionKey: "nope", edgeNodeRowId: "node_1", outcome: "succeeded" })).toEqual({ ok: false, reason: "action-not-found" });
  });

  it("encrypts an issued package immediately and never persists plaintext", async () => {
    const expiresAt = new Date(NOW.getTime() + 600_000).toISOString();
    const PACKAGE = [
      "DPF_ORGANIZATION_JOIN_V2",
      "package_id=0123456789abcdef0123456789abcdef",
      "ca_url=https://founder-hub.local:9000",
      `root_fingerprint=${"A".repeat(64)}`,
      "intended_hostname=windows-dev.local",
      "intended_sans=",
      `expires_at=${Math.floor((NOW.getTime() + 600_000) / 1000)}`,
      "enrollment_token=token-safe_123",
      "edge_client_enrollment_token=edge-safe_456",
      "",
    ].join("\n");
    const { db, update } = resultDb({ actionKey: "ra_1", status: "running", edgeNodeId: "node_1", actionType: "organization.join.issue", parameters: {} } as never);
    const result = await recordActionResult(db, {
      actionKey: "ra_1", edgeNodeRowId: "node_1", outcome: "succeeded",
      result: { joinPackage: PACKAGE }, evidence: { enrollment_token: "must-drop", exitCode: 0 },
    }, { now: NOW, encryptSecret: () => "enc:iv:tag:cipher" });
    expect(result).toEqual({ ok: true, status: "succeeded" });
    const data = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.result).toEqual({ joinPackageEnc: "enc:iv:tag:cipher", expiresAt });
    expect(JSON.stringify(data)).not.toContain("token-safe_123");
    expect(JSON.stringify(data)).not.toContain("must-drop");
  });

  it("clears imported package ciphertext on every terminal outcome", async () => {
    const { db, update } = resultDb({
      actionKey: "ra_1", status: "running", edgeNodeId: "node_1",
      actionType: "organization.join.import", parameters: { joinPackageEnc: "enc:iv:tag:cipher" },
    } as never);
    await recordActionResult(db, {
      actionKey: "ra_1", edgeNodeRowId: "node_1", outcome: "failed", evidence: { errorCode: "join_failed" },
    }, { now: NOW });
    const data = (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.parameters).toEqual({ clearedAt: NOW.toISOString() });
    expect(JSON.stringify(data)).not.toContain("enc:iv:tag:cipher");
  });
});

describe("timeoutStaleClaims", () => {
  function timeoutDb(count: number) {
    const updateMany = vi.fn().mockResolvedValue({ count });
    const findMany = vi.fn().mockResolvedValue([]);
    return {
      db: {
        remoteAction: { updateMany, findMany, findUnique: vi.fn(), update: vi.fn() },
        changeRequest: { findMany: vi.fn() },
      } as unknown as DispatchOrchestratorDb,
      updateMany,
    };
  }

  it("times out claimed/running actions past the window", async () => {
    const { db, updateMany } = timeoutDb(2);
    const res = await timeoutStaleClaims(db, { now: NOW, timeoutMs: 600_000 });
    expect(res).toEqual({ timedOut: 2 });
    const arg = updateMany.mock.calls[0]![0] as { where: { status: unknown; startedAt: { lt: Date } }; data: Record<string, unknown> };
    expect(arg.where.status).toEqual({ in: ["claimed", "running"] });
    expect((arg.where as Record<string, unknown>).actionType).toEqual({ not: "organization.join.import" });
    expect(arg.where.startedAt.lt).toEqual(new Date(NOW.getTime() - 600_000));
    expect(arg.data).toEqual({ status: "timed-out", completedAt: NOW });
  });

  it("defaults to the 10-minute window", async () => {
    const { db, updateMany } = timeoutDb(0);
    await timeoutStaleClaims(db, { now: NOW });
    const arg = updateMany.mock.calls[0]![0] as { where: { startedAt: { lt: Date } } };
    expect(arg.where.startedAt.lt).toEqual(new Date(NOW.getTime() - 10 * 60 * 1000));
  });
});

describe("clearExpiredJoinPackageMaterial", () => {
  it("atomically clears only expired, still-present package ciphertext", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { actionKey: "expired", result: { joinPackageEnc: "enc:expired", expiresAt: "2026-06-25T19:59:59.000Z" } },
      { actionKey: "future", result: { joinPackageEnc: "enc:future", expiresAt: "2026-06-25T20:10:00.000Z" } },
      { actionKey: "consumed", result: { downloadedAt: NOW.toISOString(), expiresAt: "2026-06-25T19:59:59.000Z" } },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      remoteAction: { findMany, updateMany, findUnique: vi.fn(), update: vi.fn() },
      changeRequest: { findMany: vi.fn() },
    } as unknown as DispatchOrchestratorDb;
    expect(await clearExpiredJoinPackageMaterial(db, { now: NOW })).toEqual({ cleared: 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ actionKey: "expired" }),
      data: { result: { expiresAt: "2026-06-25T19:59:59.000Z", expiredAt: NOW.toISOString() } },
    }));
  });
});
