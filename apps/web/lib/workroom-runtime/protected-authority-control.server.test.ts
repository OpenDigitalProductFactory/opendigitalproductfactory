import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { queueFencedHostRevocation, readCompleteProtectedFloorAck, readLiveProtectedHostAuthority, deliverFencedHostRevocation, type AffectedProtectedAttempt,
  type ProtectedFloorPage, type ProtectedFloorRequest } from "./protected-authority-control.server";
import type { ProtectedExecutionBinding } from "./protected-execution-binding";

const key = { sourceInstallationRef: "install-a", receiverHostRef: "host-a", authorityKind: "qualification-epoch" as const, authorityScopeRef: "qualification-a" };
const request: ProtectedFloorRequest = { version: 1, revocationId: "revoke-1", key, minimumAcceptedRevision: 8 };
const affected = [{ sessionRef: "session-a", stageAttemptRef: "stage-a", attemptRef: "attempt-a" },
  { sessionRef: "session-b", stageAttemptRef: "stage-b", attemptRef: "attempt-b" }];
const digest = (rows: AffectedProtectedAttempt[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const head = { version: 1 as const, revocationId: "revoke-1", key, appliedFloor: 8, commitRef: "store-epoch-a.commit-4", count: 2, digest: digest(affected) };
const a = { ...head, after: null, next: "next-a", affected: [affected[0]!] };
const b = { ...head, after: "next-a", next: null, affected: [affected[1]!] };

function pages(...results: (ProtectedFloorPage | null)[]) {
  const readPage = vi.fn<(_after: string | null, _commitRef: string | null) => Promise<ProtectedFloorPage | null>>();
  for (const result of results) readPage.mockResolvedValueOnce(result);
  return { readPage, isCurrentCommitRef: vi.fn(async () => true), verifyDigest: (attempts: AffectedProtectedAttempt[], expected: string) => digest(attempts) === expected };
}

describe("protected host floor acknowledgement", () => {
  it("collects only the exact immutable ack snapshot and never produces an attempt outcome", async () => {
    const port = pages(a, b);
    await expect(readCompleteProtectedFloorAck(request, port)).resolves.toEqual({ version: 1, revocationId: "revoke-1", key,
      appliedFloor: 8, commitRef: head.commitRef, affected });
    expect(port.readPage.mock.calls).toEqual([[null, null], ["next-a", head.commitRef]]);
  });

  it("does not confirm a missing page, truncation, gap, cross-snapshot page, or altered set", async () => {
    for (const pair of [[a, null], [{ ...a, next: null }], [a, { ...b, after: "wrong" }], [a, { ...b, commitRef: "other" }],
      [a, { ...b, affected: [{ ...affected[1]!, attemptRef: "altered" }] }], [a, { ...b, affected: [affected[0]!] }]] as (ProtectedFloorPage | null)[][]) {
      await expect(readCompleteProtectedFloorAck(request, pages(...pair))).resolves.toBeNull();
    }
  });

  it("does not confirm wrong scope, stale floor or a restored receiver Store epoch", async () => {
    for (const invalid of [{ ...a, key: { ...key, authorityScopeRef: "another" } }, { ...a, appliedFloor: 7 }]) {
      const port = pages(invalid, b);
      await expect(readCompleteProtectedFloorAck(request, port)).resolves.toBeNull();
      expect(port.readPage).toHaveBeenCalledTimes(1);
    }
    const restored = pages(a, b);
    restored.isCurrentCommitRef.mockResolvedValue(false);
    await expect(readCompleteProtectedFloorAck(request, restored)).resolves.toBeNull();
  });

  it("keeps an empty but complete acknowledgement distinct from absence", async () => {
    await expect(readCompleteProtectedFloorAck(request, pages({ ...head, count: 0, digest: digest([]), after: null, next: null, affected: [] })))
      .resolves.toMatchObject({ appliedFloor: 8, affected: [] });
    await expect(readCompleteProtectedFloorAck(request, pages(null))).resolves.toBeNull();
  });
});

describe("fenced host revocation delivery", () => {
  const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };

  it("uses one install-scoped event identity, not one per attempt or room", async () => {
    const enqueue = vi.fn<NonNullable<Parameters<typeof queueFencedHostRevocation>[1]["enqueue"]>>().mockResolvedValue("inserted");
    const readDurableFence = async () => ({ status: "revoked" as const, previousEpoch: 7, request });
    const conflicting = { ...request, key: { ...key, receiverHostRef: "changed-host" } };
    await expect(queueFencedHostRevocation(tx, { request, readDurableFence, enqueue })).resolves.toBe("inserted");
    await expect(queueFencedHostRevocation(tx, { request: conflicting, readDurableFence, enqueue })).rejects.toThrow("source-fence-unavailable");
    await expect(queueFencedHostRevocation(tx, { request: conflicting, enqueue,
      readDurableFence: async () => ({ ...await readDurableFence(), request: conflicting }) })).resolves.toBe("inserted");
    expect(enqueue.mock.calls[0]?.[0]).toBe(tx);
    expect(enqueue.mock.calls[0]?.[1].id).toEqual(enqueue.mock.calls[1]?.[1].id);
    expect(enqueue.mock.calls[0]?.[1].data).toEqual(request);
  });

  it("holds without a durable source fence, before enqueue, or if the floor would not advance", async () => {
    const enqueue = vi.fn();
    await expect(queueFencedHostRevocation(tx, { request, enqueue, readDurableFence: async () => null })).rejects.toThrow("source-fence-unavailable");
    await expect(queueFencedHostRevocation(tx, { request, enqueue, readDurableFence: async () => ({ status: "revoked", previousEpoch: 8, request }) }))
      .rejects.toThrow("source-fence-unavailable");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("retains pending state when the receiver or acknowledgement is unavailable", async () => {
    const lockPending = vi.fn(async () => ({ status: "revoked" as const, previousEpoch: 7, request }));
    const persistVerifiedAck = vi.fn(async () => true);
    await expect(deliverFencedHostRevocation(request, { readPendingFence: lockPending,
      openAuthenticatedReceipt: async () => pages(a, null), persistVerifiedAck })).resolves.toBe("receiver-fence-unknown");
    expect(persistVerifiedAck).not.toHaveBeenCalled();
    await expect(deliverFencedHostRevocation(request, { readPendingFence: lockPending,
      openAuthenticatedReceipt: async () => pages(a, b), persistVerifiedAck })).resolves.toBe("receiver-fenced");
    expect(persistVerifiedAck).toHaveBeenCalledWith(expect.objectContaining({ revocationId: request.revocationId, affected }));
  });
});

describe("live host authority", () => {
  const binding: ProtectedExecutionBinding = { installationRef: "install-a", registrationRef: "registration-a", hostRef: "host-a", receiverRef: "receiver-a",
    roomRef: "WC-1", sessionRef: "session-a", stageAttemptRef: "stage-a", originRef: "origin-a", qualificationRef: "qualification-a", qualificationEpoch: 7,
    routes: [{ kind: "loopback", endpointRef: "loopback-a" }], worktree: { worktreeRef: "worktree-a", repositoryFullName: "org/repo",
      sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40) } };
  const receiver = () => ({ installationRef: binding.installationRef, hostRef: binding.hostRef, receiverRef: binding.receiverRef, registrationRef: binding.registrationRef });
  const now = () => 10_000;

  it("reads positive exact authority each time and never treats previous projection or reachability as current", async () => {
    const readCurrent = vi.fn<Parameters<typeof readLiveProtectedHostAuthority>[1]["readCurrent"]>()
      .mockResolvedValueOnce({ binding, expiresAt: now() + 10 }).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("partition"));
    const input = { binding, authenticatedReceiver: receiver() };
    const deps = { readCurrent, now };
    await expect(readLiveProtectedHostAuthority(input, deps)).resolves.toEqual({ key, revision: 7, expiresAt: now() + 10 });
    await expect(readLiveProtectedHostAuthority(input, deps)).resolves.toBeNull();
    await expect(readLiveProtectedHostAuthority(input, deps)).resolves.toBeNull();
    expect(readCurrent).toHaveBeenCalledTimes(3);
  });

  it("holds wrong receiver, expired authority, and a restored earlier epoch", async () => {
    const readCurrent = vi.fn<Parameters<typeof readLiveProtectedHostAuthority>[1]["readCurrent"]>()
      .mockResolvedValueOnce({ binding, expiresAt: now() }).mockResolvedValueOnce({ binding: { ...binding, qualificationEpoch: 6 }, expiresAt: now() + 200 });
    const deps = { readCurrent, now };
    await expect(readLiveProtectedHostAuthority({ binding, authenticatedReceiver: { ...receiver(), receiverRef: "changed" } }, deps)).resolves.toBeNull();
    expect(readCurrent).not.toHaveBeenCalled();
    await expect(readLiveProtectedHostAuthority({ binding, authenticatedReceiver: receiver() }, deps)).resolves.toBeNull();
    await expect(readLiveProtectedHostAuthority({ binding, authenticatedReceiver: receiver() }, deps)).resolves.toBeNull();
  });
});
