import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  GovernedRequesterReadError,
  isGovernedRequester,
  type GovernedRequesterReader,
} from "./s5-rehearsal-enrollment.server";

function reader(findUnique: (args: unknown) => Promise<unknown>): GovernedRequesterReader {
  return { s5RehearsalRequesterEnrollment: { findUnique } } as unknown as GovernedRequesterReader;
}

describe("isGovernedRequester (BI-9F7192F9 phase 1, single durable marker)", () => {
  it("is one unique-index read keyed by userId, selecting only the id", async () => {
    const findUnique = vi.fn(async () => ({ id: "enr-1" }));
    await expect(isGovernedRequester("user-1", reader(findUnique))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" }, select: { id: true } });
  });

  it("is true for a retired requester too: the marker outlives retirement", async () => {
    const findUnique = vi.fn(async () => ({ id: "enr-retired" }));
    await expect(isGovernedRequester("user-retired", reader(findUnique))).resolves.toBe(true);
  });

  it("is false only when the read succeeds and finds no row", async () => {
    await expect(isGovernedRequester("user-2", reader(async () => null))).resolves.toBe(false);
  });

  it("reports a read error as an error, never as 'not governed' (fails closed)", async () => {
    const cause = new Error("connection reset");
    const failing = reader(async () => {
      throw cause;
    });
    const error = await isGovernedRequester("user-3", failing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GovernedRequesterReadError);
    expect((error as GovernedRequesterReadError).cause).toBe(cause);
  });

  it("refuses an empty or non-string userId without reading", async () => {
    const findUnique = vi.fn(async () => null);
    for (const bad of ["", "   ", undefined as unknown as string]) {
      await expect(isGovernedRequester(bad, reader(findUnique))).rejects.toBeInstanceOf(GovernedRequesterReadError);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("requester audit rows (BI-9F7192F9 phase 3, AC-E8)", async () => {
  const { buildRequesterAuditRow, writeRequesterAudit, S5_REQUESTER_AUDIT_ACTION_KEYS } = await import("./s5-rehearsal-enrollment.server");
  const { readS5RehearsalDecision } = await import("@/lib/workroom-runtime/s5-rehearsal-approver.server");
  const { S5_REHEARSAL_APPROVAL_ACTION } = await import("@/lib/workroom-runtime/s5-rehearsal-approval-action");
  const digest = "a".repeat(64);
  const refs = {
    rulingRef: "ruling:1", reservationRef: "reservation:1", attemptRef: "attempt:1", fixtureRef: "fixture:1",
    installationRef: "installation:1", leaseRef: "lease:1", dbIdentityRef: "db:1",
  };
  const enroll = {
    command: "enroll" as const, setupDigest: digest, ownerUserId: "owner-user", ownerPrincipalId: "owner-principal",
    requesterUserId: "requester-user", refs,
  };

  it("builds one typed row per command with the fixed keys from the design", () => {
    expect(S5_REQUESTER_AUDIT_ACTION_KEYS).toEqual({ enroll: "s5.rehearsal-requester.enroll", retire: "s5.rehearsal-requester.retire" });
    const row = buildRequesterAuditRow(enroll);
    expect(row).toMatchObject({
      decisionId: `s5rr:enroll:${digest}`, actionKey: "s5.rehearsal-requester.enroll", decision: "allow",
      actorType: "human", actorRef: "owner-user", objectRef: "requester-user",
    });
    const retire = buildRequesterAuditRow({ ...enroll, command: "retire", retirementReason: "rehearsal_complete" });
    expect(retire).toMatchObject({ decisionId: `s5rr:retire:${digest}`, actionKey: "s5.rehearsal-requester.retire" });
    expect((retire.rationale as Record<string, unknown>).retirementReason).toBe("rehearsal_complete");
  });

  it("carries references only: no password, hash, token or session material", () => {
    const serialized = JSON.stringify(buildRequesterAuditRow(enroll)).toLowerCase();
    for (const secret of ["password", "hash", "token", "session", "secret"]) expect(serialized).not.toContain(secret);
  });

  it("refuses a malformed digest, a missing ref, an unknown command or a retire without its reason", () => {
    expect(() => buildRequesterAuditRow({ ...enroll, setupDigest: "abc" })).toThrow();
    expect(() => buildRequesterAuditRow({ ...enroll, refs: { ...refs, leaseRef: "" } })).toThrow();
    expect(() => buildRequesterAuditRow({ ...enroll, command: "activate" as never })).toThrow();
    expect(() => buildRequesterAuditRow({ ...enroll, command: "retire" })).toThrow();
  });

  it("writes exactly one row through the caller's transaction", async () => {
    const create = vi.fn(async () => ({}));
    await writeRequesterAudit({ authorizationDecisionLog: { create } }, enroll);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: buildRequesterAuditRow(enroll) });
  });

  it("is rejected by the S5 approval reader, so an audit row can never stand in for an approval", async () => {
    const row = buildRequesterAuditRow(enroll);
    const findUnique = vi.fn(async () => ({ ...row, agentContextRef: "AGT-1", authorityBindingId: "binding-1" }));
    const decision = await readS5RehearsalDecision({ authorizationDecisionLog: { findUnique } } as never, {
      id: "env-1", manifestActionId: S5_REHEARSAL_APPROVAL_ACTION, argsJson: {}, authorityDecisionId: row.decisionId,
      inputFingerprint: "f", approvalBindingFingerprint: "b", delegatingUserId: "owner-user", coworkerAgentId: "AGT-1",
    }, "owner-user");
    expect(decision).toBeNull();
  });
});
