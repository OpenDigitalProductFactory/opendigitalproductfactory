import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiptDb } from "@/lib/work-capsules/command-receipts";
import type { S5AdmissionCeiling } from "./s5-admission.server";
import { createS5CredentialLifecycle, type S5CredentialLifecyclePorts } from "./s5-credential-lifecycle.server";

const now = new Date("2026-11-25T12:00:00.000Z");
const receiver = { issuer: "fixture-install", audience: "fixture-control", hostRef: "fixture-host", resource: "https://fixture.invalid/s5" };
const attempt = { workroomId: "WC-FIXTURE", sessionRef: "session-a", stageAttemptRef: "attempt-a" };
const mint = { ...attempt, roomRowId: "row-a", commandId: "open-a", receiver };
const release = { ...attempt, roomRowId: "row-a", commandId: "release-a", reason: "attempt-released" as const };
const admission: S5AdmissionCeiling = { kind: "composed", locator: attempt, agentId: "AGT-FIXTURE", issuer: receiver.issuer,
  stageKey: "working", caseKey: "case-a", activityKey: "fixture-coding", job: { id: "engineering", version: "1" },
  subject: { principalId: "PRN-FIXTURE", gaid: "gaid:priv:fixture:agent" }, authorityBindingId: "binding-row",
  bindingRef: "binding-a", permitRef: "permit-a", grantKeys: ["file_read"],
  host: { mode: "bounded-coding", hostRef: receiver.hostRef, receiverRef: receiver.audience, worktreeRef: "tree-a" },
  jsi: { kind: "not-applicable" }, operationKeys: ["read_project_file"] };
const rehearsalActivity = "s5-route-handoff";
const rehearsalAdmission: S5AdmissionCeiling = { ...admission, activityKey: rehearsalActivity, operationKeys: ["get_workroom"],
  host: { ...admission.host, mode: "read-only-coordination", worktreeRef: null },
  jsi: { kind: "rehearsal-qualification", approvalRef: "approval-a", ownerPrincipalId: "PRN-OWNER", statusRevision: 1,
    approvalRevision: 1, validUntil: now.getTime() + 300_000, syntheticTarget: {
      environment: "non-production", caseKey: admission.caseKey, databaseRef: "fixture-db", fixtureRef: "fixture-a",
      destinationRef: "relay-a", recipient: { authorityRef: "recipient-a", destinationRef: "destination-a", reservationRef: "reservation-a" },
    } } };

describe("S5 Control credential lifecycle, with no client hooks", () => {
  const trace: string[] = [];
  const receipts = new Map<string, { kind: string; payload: unknown }>();
  const create = vi.fn();
  const updateMany = vi.fn();
  const tx: ReceiptDb = {
    $queryRaw: vi.fn(async () => { trace.push("room lock"); return [{ id: "row-a" }]; }),
    $executeRaw: vi.fn(async (sql: TemplateStringsArray) => { if (sql[0]?.includes("advisory")) trace.push("command lock"); return 0; }),
    workroomActivity: {
      findFirst: async (input: unknown) => receipts.get((input as { where: { commandKey: string } }).where.commandKey) ?? null,
      create: async (input: unknown) => {
        const { data } = input as { data: { commandKey: string; kind: string; payload: unknown } };
        receipts.set(data.commandKey, data);
        return {};
      },
    },
  };
  const db: ReceiptDb = { ...tx, $transaction: (run) => run(tx) };
  const getTokenStore = vi.fn(() => ({ create, updateMany }));
  const lockOwners = vi.fn(async () => { trace.push("owner locks"); return true; });
  const checkAccess = vi.fn(async () => { trace.push("access"); return true; });
  const readAttempt = vi.fn<S5CredentialLifecyclePorts["readAttempt"]>();
  const composeAdmission = vi.fn<S5CredentialLifecyclePorts["composeAdmission"]>();
  const pinToken = vi.fn<S5CredentialLifecyclePorts["pinToken"]>();
  const closeAttempt = vi.fn<S5CredentialLifecyclePorts["closeAttempt"]>();
  const active = { ...attempt, roomRowId: "row-a", userId: "user-a", permitExpiresAt: new Date(now.getTime() + 60_000),
    status: "active" as const, tokenId: null };
  const lifecycle = createS5CredentialLifecycle({ db, getTokenStore, lockOwners, checkAccess, readAttempt, composeAdmission, pinToken, closeAttempt, now: () => now });

  beforeEach(() => {
    vi.clearAllMocks();
    trace.length = 0;
    receipts.clear();
    readAttempt.mockResolvedValue(active);
    composeAdmission.mockResolvedValue(admission);
    create.mockResolvedValue({ id: "token-a" });
    updateMany.mockResolvedValue({ count: 1 });
    lockOwners.mockImplementation(async () => { trace.push("owner locks"); return true; });
    checkAccess.mockImplementation(async () => { trace.push("access"); return true; });
    pinToken.mockResolvedValue(true);
    closeAttempt.mockResolvedValue(true);
  });

  it("mints one bearer after exact admission and pin, and never stores or replays plaintext", async () => {
    const issued = await lifecycle.issue(mint);
    expect(issued).toMatchObject({ kind: "issued", tokenId: "token-a", plaintext: expect.stringMatching(/^dpfroom_/u) });
    expect(trace).toEqual(["command lock", "owner locks", "room lock", "access"]);
    expect(composeAdmission).toHaveBeenCalledWith(tx, attempt);
    expect(pinToken).toHaveBeenCalledWith(tx, active, "token-a", active.permitExpiresAt.getTime());
    expect(JSON.stringify([...receipts.values()])).not.toContain(issued.kind === "issued" ? issued.plaintext : "dpfroom_");
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    expect(create).toHaveBeenCalledOnce();
  });

  it("persists the DPF-clock rehearsal deadline in the token, owner pin and mint receipt, not a request echo", async () => {
    const rehearsal = { ...active, permitExpiresAt: new Date(now.getTime() + 600_000), executionProfile: "synthetic-rehearsal" as const };
    const deadline = now.getTime() + 120_000;
    readAttempt.mockResolvedValue(rehearsal);
    composeAdmission.mockResolvedValue(rehearsalAdmission);
    const withEcho = { ...mint, expiresAt: now.getTime() + 600_000 };
    expect(await lifecycle.issue(withEcho)).toEqual({ kind: "held" });
    expect(create).not.toHaveBeenCalled();
    expect(await lifecycle.issue(mint)).toMatchObject({ kind: "issued", expiresAt: deadline });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expiresAt: new Date(deadline) }) }));
    expect(pinToken).toHaveBeenCalledWith(tx, rehearsal, "token-a", deadline);
    expect(receipts.get(mint.commandId)?.payload).toMatchObject({ result: { kind: "issued", tokenId: "token-a", expiresAt: deadline } });
  });

  it("cannot use the waiver to mint for an ordinary attempt or canonical evidence to enter the waiver path", async () => {
    composeAdmission.mockResolvedValueOnce(rehearsalAdmission);
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    readAttempt.mockResolvedValue({ ...active, executionProfile: "synthetic-rehearsal" });
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    expect(create).not.toHaveBeenCalled();
    expect(pinToken).not.toHaveBeenCalled();
  });

  it("holds without current access, the dependency locks, an exact active attempt or current admission", async () => {
    lockOwners.mockResolvedValueOnce(false);
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    checkAccess.mockResolvedValueOnce(false);
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    readAttempt.mockResolvedValueOnce({ ...active, stageAttemptRef: "stale" });
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    readAttempt.mockResolvedValueOnce({ ...active, status: "released" });
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    readAttempt.mockResolvedValueOnce({ ...active, tokenId: "already-issued" });
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    composeAdmission.mockResolvedValueOnce(null);
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    expect(await lifecycle.issue({ ...mint, receiver: { ...receiver, audience: "other-control" } })).toEqual({ kind: "held" });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not disclose a bearer if the pin is lost or commit is unknown", async () => {
    pinToken.mockResolvedValueOnce(false);
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    const failedCommit: ReceiptDb = { ...db, $transaction: async (run) => {
      await run(tx);
      throw new Error("commit outcome unknown");
    } };
    const other = createS5CredentialLifecycle({ db: failedCommit, getTokenStore, lockOwners, checkAccess, readAttempt, composeAdmission, pinToken, closeAttempt, now: () => now });
    expect(await other.issue(mint)).toEqual({ kind: "held" });
  });

  it("fences and revokes only the pinned attempt in the same transaction and never on stale release", async () => {
    readAttempt.mockResolvedValueOnce({ ...active, stageAttemptRef: "attempt-b", tokenId: "token-b" });
    expect(await lifecycle.release(release)).toEqual({ kind: "held" });
    expect(updateMany).not.toHaveBeenCalled();
    const pinned = { ...active, tokenId: "token-a" };
    readAttempt.mockResolvedValue(pinned);
    expect(await lifecycle.release(release)).toEqual({ kind: "released" });
    expect(closeAttempt).toHaveBeenCalledExactlyOnceWith(tx, pinned);
    expect(updateMany.mock.calls[0]?.[0]?.where).toMatchObject({ id: "token-a", workroomRef: attempt.workroomId, runRef: attempt.sessionRef });
    expect(await lifecycle.release(release)).toEqual({ kind: "released" });
    expect(updateMany).toHaveBeenCalledOnce();
    readAttempt.mockResolvedValue({ ...pinned, status: "released" });
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    expect(create).not.toHaveBeenCalled();
  });

  it("fences release-before-mint even when no token was issued", async () => {
    expect(await lifecycle.release(release)).toEqual({ kind: "released" });
    expect(closeAttempt).toHaveBeenCalledWith(tx, active);
    expect(updateMany).not.toHaveBeenCalled();
    readAttempt.mockResolvedValue({ ...active, status: "released" });
    expect(await lifecycle.issue(mint)).toEqual({ kind: "held" });
    expect(create).not.toHaveBeenCalled();
  });
});
