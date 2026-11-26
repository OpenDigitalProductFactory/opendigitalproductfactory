import { describe, expect, it, vi } from "vitest";
import { s5ApprovalFixture } from "./s5-rehearsal-approval.test-support";

// WC-14E7E2F3 / F2 and V2. These are server-owner doubles, not enrollment
// authority, and cannot reach an installation, credential store or provider.
const attempt = { workroomId: "WC-SYNTHETIC", sessionRef: "session-fixture", stageKey: "working", stageAttemptRef: "attempt-a" };
const setupKey = { rulingRef: "ruling-fixture", reservationId: "reservation-a" };
const preview = { installationId: "install-fixture", leaseId: "NPEL-FIXTURE", databaseId: "preview-db:NPEL-FIXTURE", sourceSha: "a".repeat(40) };
const requester = { principalId: "PRN-SYNTHETIC", userId: "user-synthetic" };
const approver = { principalId: "PRN-OWNER", userId: "user-owner", managePlatform: true };
const enrollment = { ...setupKey, ...attempt, ...requester, fixtureRef: "fixture-a" };
const requesterAuthority = {
  ...requester, principalKind: "human", localUserAlias: requester.userId, active: true, superuser: false,
  automation: false, delegationCurrent: true,
};
const currentRoleLinks = { requestedByPrincipalId: requester.principalId, taskUserId: requester.userId };
const currentReservation = { ...setupKey, ...attempt, leaseId: preview.leaseId, status: "active" as const };
const rollbackTarget = { ...setupKey, ...attempt, ...requester };
const revocation = { ...rollbackTarget, receiptId: "revoke-1", credentialRevoked: true, delegationRevoked: true, sessionsTerminated: true, readBackAt: 10 };
const retirement = { ...rollbackTarget, receiptId: "retire-1", userRetired: true, retiredAt: 20 };
const completion = { ...rollbackTarget, receiptId: "complete-1", revocationReceiptId: "revoke-1", retirementReceiptId: "retire-1", completedAt: 30 };
const actor = { agentId: "agent-id", principalId: "PRN-INVOKER", userId: approver.userId, leaseId: preview.leaseId };
const draft = { ...s5ApprovalFixture(), approverPrincipalId: approver.principalId,
  snapshot: { ...s5ApprovalFixture().snapshot, ...attempt } };

type OneShotReservation = Omit<typeof currentReservation, "status"> & { status: "active" | "approved" | "spent" };

// Spy on both effect boundaries. A forbidden mutation fails the test even if
// the service subsequently returns held, catches the error, or rolls back.
const forbidden = vi.hoisted(() => {
  const deny = () => vi.fn(() => { throw new Error("User and credential mutations are operator-only."); });
  const mutators = () => ({
    create: deny(), createMany: deny(), update: deny(), updateMany: deny(),
    upsert: deny(), delete: deny(), deleteMany: deny(),
  });
  return {
    user: mutators(), principal: mutators(), principalAlias: mutators(),
    authorityBinding: mutators(), authorityBindingSubject: mutators(), authorityBindingGrant: mutators(),
    mcpApiToken: mutators(), oAuthRefreshToken: mutators(), session: mutators(),
  };
});
vi.mock("@dpf/db", () => ({ prisma: forbidden }));

function setup() {
  type Row = { kind: string; payload: unknown };
  let receipt: Row | null = null;
  let stored: unknown = null;
  const tx = {
    workroomActivity: {
      findFirst: vi.fn(async () => receipt),
      create: vi.fn(async ({ data }: { data: Row }) => { receipt = data; }),
    },
    $queryRaw: vi.fn(async () => [{ id: "internal-room" }]),
    $executeRaw: vi.fn(async () => 1),
  };
  const ports = {
    readInstallationProof: vi.fn<() => Promise<(typeof preview & { environment: "non-production" | "production" }) | null>>()
      .mockResolvedValue({ ...preview, environment: "non-production" }),
    readDatabaseIdentity: vi.fn<() => Promise<string | null>>().mockResolvedValue(preview.databaseId),
    readLeaseReservation: vi.fn<() => Promise<(typeof preview & typeof attempt) | null>>()
      .mockResolvedValue({ ...preview, ...attempt }),
    readOneShotReservation: vi.fn<() => Promise<OneShotReservation | null>>()
      .mockResolvedValue(currentReservation),
    readEnrollmentReceipt: vi.fn<() => Promise<(Partial<typeof setupKey & typeof attempt> & typeof requester & { fixtureRef: string }) | null>>()
      .mockResolvedValue(enrollment),
    readRequesterAuthority: vi.fn<() => Promise<(Omit<typeof requesterAuthority, "localUserAlias"> & { localUserAlias: string | null }) | null>>()
      .mockResolvedValue(requesterAuthority),
    readApproverAuthority: vi.fn<() => Promise<typeof approver | null>>().mockResolvedValue(approver),
    readCurrentRoleLinks: vi.fn<() => Promise<typeof currentRoleLinks | null>>().mockResolvedValue(currentRoleLinks),
    readInvoker: vi.fn().mockResolvedValue(actor),
    readReviewedDraft: vi.fn().mockResolvedValue(draft),
    locateRoom: vi.fn().mockResolvedValue("internal-room"),
    lockOwnerRows: vi.fn().mockResolvedValue(true),
    quarantineAttempt: vi.fn().mockResolvedValue(rollbackTarget),
    readOwnerRetirement: vi.fn().mockResolvedValue(retirement),
    readRollbackCompletion: vi.fn().mockResolvedValue(completion),
    readOwnerRevocation: vi.fn<() => Promise<typeof revocation | null>>().mockResolvedValue(revocation),
    tx,
    createWorkroom: vi.fn(),
    createTaskRun: vi.fn(),
    readStoredDraft: vi.fn(async () => stored),
    writeDraft: vi.fn(async (_tx: unknown, _id: string, value: unknown) => { stored = value; return true; }),

    closeWorkroom: vi.fn().mockResolvedValue(true),
    cancelTaskRun: vi.fn().mockResolvedValue(true),
    releaseLease: vi.fn().mockResolvedValue(true),
    fileOperatorRequest: vi.fn().mockResolvedValue(true),
    db: { ...tx, $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) },
  };
  for (const group of Object.values(forbidden)) {
    for (const mutation of Object.values(group)) mutation.mockClear();
  }
  return ports;
}

type Provisioner = {
  provision: (locator: typeof attempt) => Promise<{ kind: string }>;
  rollback: (locator: typeof attempt) => Promise<{ kind: string }>;
};
type ProvisionerModule = {
  createS5RehearsalDraftProvisioner: (ports?: ReturnType<typeof setup>) => Provisioner;
};
// Report the unimplemented boundary as Red rather than importing an absent file
// at transform time. Behavior cases remain explicitly unrun until it is added.
const load = import.meta.glob<ProvisionerModule>("./s5-rehearsal-draft-provisioner.server.ts")
  ["./s5-rehearsal-draft-provisioner.server.ts"];

function expectNoIdentityMutations() {
  for (const group of Object.values(forbidden)) {
    for (const mutation of Object.values(group)) expect(mutation).not.toHaveBeenCalled();
  }
}

function expectNoSetupWrites(ports: ReturnType<typeof setup>) {
  for (const write of [ports.createWorkroom, ports.createTaskRun, ports.writeDraft, ports.tx.workroomActivity.create]) {
    expect(write).not.toHaveBeenCalled();
  }
  expectNoIdentityMutations();
}

it("provides the governed server-side provisioner entry point", async () => {
  expect(load, "F2 is not implemented: no governed provisioner entry point exists").toBeTypeOf("function");
  expect((await load!()).createS5RehearsalDraftProvisioner).toBeTypeOf("function");
});

describe.runIf(Boolean(load))("S5 rehearsal provisioner refusal contracts (F2/V2)", () => {
  async function provisioner(ports: ReturnType<typeof setup>) {
    return (await load!()).createS5RehearsalDraftProvisioner(ports);
  }

  async function seedReplay(ports: ReturnType<typeof setup>) {
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "provisioned" });
    ports.writeDraft.mockClear();
    ports.tx.workroomActivity.create.mockClear();
  }

  for (const mode of ["fresh", "replay"] as const) {
    it.each([
      ["BI-5C193A3F: actual database proof", "readDatabaseIdentity"],
      ["BI-8EA98961: attested non-production installation", "readInstallationProof"],
      ["BI-60FC9291: remote lease reservation", "readLeaseReservation"],
      ["BI-9F7192F9: owner enrollment receipt", "readEnrollmentReceipt"],
      ["BI-588688A7: live one-shot owner reservation", "readOneShotReservation"],
    ] as const)(`holds a ${mode} setup with no writes when %s is unavailable`, async (_dependency, read) => {
      const ports = setup();
      if (mode === "replay") await seedReplay(ports);
      ports[read].mockResolvedValue(null);
      expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
      expectNoSetupWrites(ports);
    });

    it.each([
      ["an approved ruling on another lease", { ...currentReservation, leaseId: "lease-previous", status: "approved" }],
      ["a spent ruling on another lease", { ...currentReservation, leaseId: "lease-previous", status: "spent" }],
      ["a competing active reservation", { ...currentReservation, reservationId: "reservation-b", stageAttemptRef: "attempt-b" }],
    ] as const)(`holds ${mode} with no writes for %s`, async (_case, reservation) => {
      const ports = setup();
      if (mode === "replay") await seedReplay(ports);
      ports.readOneShotReservation.mockResolvedValue(reservation);
      expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
      expectNoSetupWrites(ports);
    });
  }

  it.each([
    ["missing attempt", { stageAttemptRef: undefined }],
    ["wrong attempt", { stageAttemptRef: "attempt-b" }],
    ["missing ruling reference", { rulingRef: undefined }],
    ["wrong ruling reference", { rulingRef: "ruling-other" }],
    ["missing reservation id", { reservationId: undefined }],
    ["wrong reservation id", { reservationId: "reservation-b" }],
    ["different reviewed fixture", { fixtureRef: "fixture-other" }],
  ] as const)("holds without writes for an enrollment receipt with %s", async (_case, change) => {
    const ports = setup();
    ports.readEnrollmentReceipt.mockResolvedValue({ ...enrollment, ...change });
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it.each([
    ["an absent local user alias", { localUserAlias: null }],
    ["a mismatched local user alias", { localUserAlias: "user-other" }],
    ["a changed Principal on the enrolled user", { principalId: "PRN-OTHER" }],
    ["a changed User on the enrolled Principal", { userId: "user-other" }],
    ["a dormant requester", { active: false }],
    ["an automation requester", { automation: true }],
    ["an agent Principal on a human enrollment", { principalKind: "agent" }],
    ["revoked coworker delegation", { delegationCurrent: false }],
  ] as const)("holds without writes for %s even with a matching enrollment receipt", async (_case, change) => {
    const ports = setup();
    ports.readRequesterAuthority.mockResolvedValue({ ...requesterAuthority, ...change });
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it.each([
    ["the requester Principal as approver", { principalId: requester.principalId }],
    ["the TaskRun user as approver", { userId: requester.userId }],
    ["the owner without current manage_platform", { managePlatform: false }],
    ["a replacement approver with manage_platform", { principalId: "PRN-REPLACEMENT", userId: "user-replacement" }],
  ] as const)("holds a replay without writes for %s", async (_case, change) => {
    const ports = setup();
    await seedReplay(ports);
    ports.readApproverAuthority.mockResolvedValue({ ...approver, ...change });
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it.each([
    ["missing current attribution", null],
    ["the Workroom attributed to the owner", { ...currentRoleLinks, requestedByPrincipalId: approver.principalId }],
    ["the TaskRun assigned to the owner", { ...currentRoleLinks, taskUserId: approver.userId }],
    ["the TaskRun reassigned to a different non-owner user", { ...currentRoleLinks, taskUserId: "user-other" }],
  ] as const)("holds replay without writes for %s despite the enrolled requester still being valid", async (_case, links) => {
    const ports = setup();
    await seedReplay(ports);
    ports.readCurrentRoleLinks.mockResolvedValue(links);
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it("holds an attested production installation even with a matching lease and database", async () => {
    const ports = setup();
    ports.readInstallationProof.mockResolvedValue({ ...preview, environment: "production" });
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it("holds when the actual database differs despite a matching leased target", async () => {
    const ports = setup();
    ports.readDatabaseIdentity.mockResolvedValue("other-isolated-database");
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it.each([
    ["a replaced lease", { leaseId: "lease-other" }],
    ["another installation using the same database", { installationId: "install-other" }],
    ["another stage attempt under the same lease", { stageAttemptRef: "attempt-other" }],
  ] as const)("holds without writes when remote lease proof belongs to %s", async (_case, change) => {
    const ports = setup();
    ports.readLeaseReservation.mockResolvedValue({ ...preview, ...attempt, ...change });
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it.each([
    ["absent", null], ["for another reservation", { ...revocation, reservationId: "reservation-b" }],
    ["for another attempt", { ...revocation, stageAttemptRef: "attempt-b" }],
    ["for another requester", { ...revocation, userId: "user-other" }],
    ["without credential revocation", { ...revocation, credentialRevoked: false }],
    ["without delegate revocation", { ...revocation, delegationRevoked: false }],
    ["without session termination", { ...revocation, sessionsTerminated: false }],
  ] as const)(
    "keeps rollback held with owner revocation proof %s",
    async (_case, evidence) => {
      const ports = setup();
      ports.readOwnerRevocation.mockResolvedValue(evidence);
      expect(await (await provisioner(ports)).rollback(attempt)).toMatchObject({ kind: "held" });
      expect(ports.quarantineAttempt).toHaveBeenCalled();
      expect(ports.fileOperatorRequest).toHaveBeenCalled();
      expect(ports.readOwnerRetirement).not.toHaveBeenCalled();
      expectNoSetupWrites(ports);
    },
  );

  it("keeps rollback held when agent-side compensation fails despite exact owner evidence", async () => {
    const ports = setup();
    ports.cancelTaskRun.mockRejectedValue(new Error("Could not confirm TaskRun cancellation."));
    expect(await (await provisioner(ports)).rollback(attempt)).toMatchObject({ kind: "held" });
    expect(ports.quarantineAttempt).toHaveBeenCalledOnce();
    expect(ports.cancelTaskRun).toHaveBeenCalledOnce();
    expectNoSetupWrites(ports);
  });

  it("writes once under the canonical command lock and replays without writes", async () => {
    const ports = setup();
    const subject = await provisioner(ports);
    const first = await subject.provision(attempt);
    expect(first).toMatchObject({ kind: "provisioned" });
    expect(await subject.provision(attempt)).toEqual(first);
    expect(ports.writeDraft).toHaveBeenCalledExactlyOnceWith(ports.tx, "internal-room", draft);
    expect(ports.tx.workroomActivity.create).toHaveBeenCalledOnce();
    expect(ports.lockOwnerRows).toHaveBeenCalledBefore(ports.tx.$queryRaw);
    expect(ports.writeDraft).toHaveBeenCalledBefore(ports.tx.workroomActivity.create);
    expectNoIdentityMutations();
  });

  it("holds changing the reviewed draft after an exact receipt exists", async () => {
    const ports = setup();
    await seedReplay(ports);
    ports.readReviewedDraft.mockResolvedValue({ ...draft, shapeRef: "shape@2" });
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it.each([null, { ...actor, leaseId: "other" }, { ...actor, principalId: requester.principalId }])(
    "refuses an absent, foreign, or requester-attributed invoker (%j)", async invoker => {
      const ports = setup();
      ports.readInvoker.mockResolvedValue(invoker);
      expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
      expectNoSetupWrites(ports);
    });

  it("does not adopt a draft without the original canonical receipt", async () => {
    const ports = setup();
    ports.readStoredDraft.mockResolvedValue(draft);
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expectNoSetupWrites(ports);
  });

  it("does not publish a canonical receipt when the draft write refuses", async () => {
    const ports = setup();
    ports.writeDraft.mockResolvedValue(false);
    expect(await (await provisioner(ports)).provision(attempt)).toMatchObject({ kind: "held" });
    expect(ports.tx.workroomActivity.create).not.toHaveBeenCalled();
    expectNoIdentityMutations();
  });

  it("never compensates when quarantine does not bind the requested attempt", async () => {
    const ports = setup();
    ports.quarantineAttempt.mockResolvedValue({ ...rollbackTarget, stageAttemptRef: "other" });
    expect(await (await provisioner(ports)).rollback(attempt)).toMatchObject({ kind: "held" });
    expect(ports.closeWorkroom).not.toHaveBeenCalled();
    expect(ports.readOwnerRevocation).not.toHaveBeenCalled();
  });

  it("keeps rollback quarantined when retirement preceded revocation readback", async () => {
    const ports = setup();
    ports.readOwnerRetirement.mockResolvedValue({ ...retirement, retiredAt: 9 });
    expect(await (await provisioner(ports)).rollback(attempt)).toMatchObject({ kind: "held" });
    expect(ports.readOwnerRevocation).toHaveBeenCalledBefore(ports.readOwnerRetirement);
    expect(ports.readRollbackCompletion).not.toHaveBeenCalled();
  });

  it.each([null, { ...completion, revocationReceiptId: "another" }, { ...completion, userId: "other" }])(
    "holds rollback without an exact joined receipt (%j)", async (joined) => {
      const ports = setup();
      ports.readRollbackCompletion.mockResolvedValue(joined);
      expect(await (await provisioner(ports)).rollback(attempt)).toMatchObject({ kind: "held" });
      expect(ports.quarantineAttempt).toHaveBeenCalledOnce();
      expectNoSetupWrites(ports);
    });

  it("returns rollback completion only for ordered, joined current owner proofs", async () => {
    const ports = setup();
    expect(await (await provisioner(ports)).rollback(attempt)).toEqual({ kind: "rolled-back", receiptId: completion.receiptId });
    expect(ports.quarantineAttempt).toHaveBeenCalledBefore(ports.readOwnerRevocation);
    expect(ports.readOwnerRevocation).toHaveBeenCalledBefore(ports.readOwnerRetirement);
    expect(ports.readOwnerRetirement).toHaveBeenCalledBefore(ports.readRollbackCompletion);
    expectNoSetupWrites(ports);
  });

  it("has an unserved default that holds provisioning and rollback", async () => {
    const subject = (await load!()).createS5RehearsalDraftProvisioner();
    expect(await subject.provision(attempt)).toMatchObject({ kind: "held" });
    expect(await subject.rollback(attempt)).toMatchObject({ kind: "held" });
  });
});
