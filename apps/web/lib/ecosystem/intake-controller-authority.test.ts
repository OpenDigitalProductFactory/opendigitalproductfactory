import { describe, expect, it, vi } from "vitest";

import {
  commissionIntakeController,
  evaluateIntakeControllerAuthority,
  evaluateIntakeControllerClauses,
  INTAKE_CONTROLLER_CLAUSE_IDS,
  loadIntakeControllerCommission,
  type IntakeControllerDb,
  type IntakeControllerFacts,
} from "./intake-controller-authority";
import {
  INTAKE_CONTROLLER_COMMISSION_KEY,
  INTAKE_CONTROLLER_WORK_SHAPE,
  parseIntakeControllerCommission,
  type IntakeControllerCommission,
} from "@/lib/operate/scheduled-jobs/intake-controller-commission";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
const OWNER = "principal-row-owner";

const commission: IntakeControllerCommission = {
  workroomCapsuleId: "WC-CONTROLLER",
  repositoryFullName: REPO,
  workShape: INTAKE_CONTROLLER_WORK_SHAPE,
  commissionedByPrincipalId: OWNER,
  commissionedAt: "2026-10-13T09:00:00.000Z",
};

const confirmedIntent = {
  status: "valid" as const,
  intent: {
    schemaVersion: 1 as const,
    primaryPurpose: "evolve-dpf" as const,
    secondaryPurposes: [],
    relationshipIntents: [],
    evidence: [],
    confidence: "high" as const,
    confirmation: { status: "confirmed" as const, confirmedAt: "2026-10-01T00:00:00.000Z", confirmedByPrincipalId: "p" },
  },
};

const facts = (overrides: Partial<IntakeControllerFacts> = {}): IntakeControllerFacts => ({
  commission,
  workroom: {
    capsuleId: "WC-CONTROLLER",
    status: "working",
    archivedAt: null,
    repositoryFullName: REPO,
    scopeClaims: [{ workShape: INTAKE_CONTROLLER_WORK_SHAPE, recordedAt: "2026-10-01T00:00:00.000Z" }],
    participants: [
      { principalId: OWNER, roles: ["accountable"], lifecycle: "active", principal: { kind: "human", status: "active" } },
    ],
  },
  mirroredFromPeer: false,
  upstreamRemoteUrl: `https://github.com/${REPO}.git`,
  intent: confirmedIntent,
  environment: { environmentClass: "production", declared: true },
  ...overrides,
});

const refusal = (input: IntakeControllerFacts) => {
  const verdict = evaluateIntakeControllerAuthority(input);
  if (verdict.commissioned) throw new Error("expected a refusal");
  expect(verdict.reason).toMatch(/^not commissioned: /);
  return verdict.reason;
};

describe("evaluateIntakeControllerAuthority", () => {
  it("accepts a locally owned, production, confirmed evolve-dpf controller on the explicit repository", () => {
    expect(evaluateIntakeControllerAuthority(facts())).toEqual({
      commissioned: true,
      workroomCapsuleId: "WC-CONTROLLER",
      repo: { owner: "OpenDigitalProductFactory", name: "opendigitalproductfactory" },
    });
  });

  it("refuses without a commission reference and names the missing owner binding", () => {
    expect(refusal(facts({ commission: null }))).toMatch(/no controller workroom.*issue-triage-watch@1\.0\.0/);
  });

  it("refuses a referenced workroom that does not exist", () => {
    expect(refusal(facts({ workroom: null }))).toMatch(/WC-CONTROLLER was not found/);
  });

  it.each(["complete", "abandoned", "archived"])("refuses a %s workroom", (status) => {
    expect(refusal(facts({ workroom: { ...facts().workroom!, status } }))).toMatch(new RegExp(`is ${status}`));
  });

  it("refuses an archived workroom whatever its status says", () => {
    expect(refusal(facts({ workroom: { ...facts().workroom!, archivedAt: new Date("2026-10-02") } }))).toMatch(/archived/);
  });

  it("refuses a workroom that does not declare issue-triage-watch@1.0.0", () => {
    const other = { ...facts().workroom!, scopeClaims: [{ workShape: "pull-request-flow-watch@1.0.0", recordedAt: "2026-10-01T00:00:00.000Z" }] };
    expect(refusal(facts({ workroom: other }))).toMatch(/pull-request-flow-watch@1\.0\.0, not issue-triage-watch@1\.0\.0/);
    expect(refusal(facts({ workroom: { ...facts().workroom!, scopeClaims: [] } }))).toMatch(/no work shape/);
  });

  it("refuses a workroom that mirrors peer-owned work", () => {
    expect(refusal(facts({ mirroredFromPeer: true }))).toMatch(/peer-owned.*not locally owned/);
  });

  it("refuses when no explicit upstream repository is configured, never falling back", () => {
    expect(refusal(facts({ upstreamRemoteUrl: null }))).toMatch(/no explicit upstream repository/);
    expect(refusal(facts({ upstreamRemoteUrl: "https://gitlab.example/x/y" }))).toMatch(/not a GitHub repository/);
  });

  it("refuses a workroom for a different repository than the configured upstream", () => {
    expect(refusal(facts({ upstreamRemoteUrl: "git@github.com:someone/fork.git" })))
      .toMatch(/is for OpenDigitalProductFactory\/opendigitalproductfactory, not the configured upstream someone\/fork/);
    expect(refusal(facts({ workroom: { ...facts().workroom!, repositoryFullName: null } }))).toMatch(/no repository/);
  });

  it("compares repository names case-insensitively", () => {
    expect(evaluateIntakeControllerAuthority(facts({
      upstreamRemoteUrl: "https://github.com/opendigitalproductfactory/OpenDigitalProductFactory",
    })).commissioned).toBe(true);
  });

  it("refuses when the commission names a different repository than the workroom", () => {
    expect(refusal(facts({ commission: { ...commission, repositoryFullName: "someone/fork" } })))
      .toMatch(/commission names someone\/fork/);
  });

  it("refuses without an active local accountable or coordinator owner", () => {
    const base = facts().workroom!;
    const owner = base.participants[0]!;
    expect(refusal(facts({ workroom: { ...base, participants: [] } }))).toMatch(/no active local accountable or coordinator owner/);
    expect(refusal(facts({ workroom: { ...base, participants: [{ ...owner, lifecycle: "removed" }] } }))).toMatch(/no active local/);
    expect(refusal(facts({ workroom: { ...base, participants: [{ ...owner, roles: ["contributor"] }] } }))).toMatch(/no active local/);
    expect(refusal(facts({ workroom: { ...base, participants: [{ ...owner, principal: { kind: "external-agent", status: "active" } }] } })))
      .toMatch(/no active local/);
    expect(refusal(facts({ workroom: { ...base, participants: [{ ...owner, principal: { kind: "human", status: "inactive" } }] } })))
      .toMatch(/no active local/);
  });

  it("invalidates the commission once the commissioning owner no longer owns the room", () => {
    const base = facts().workroom!;
    const reassigned = {
      ...base,
      participants: [
        { ...base.participants[0]!, roles: ["contributor"] },
        { principalId: "someone-else", roles: ["coordinator"], lifecycle: "active", principal: { kind: "human", status: "active" } },
      ],
    };
    expect(refusal(facts({ workroom: reassigned }))).toMatch(/commissioning principal no longer owns workroom WC-CONTROLLER/);
  });

  it("refuses on an installation that is not declared production (a DEV peer cannot become controller)", () => {
    expect(refusal(facts({ environment: { environmentClass: "development", declared: true } })))
      .toBe("not commissioned: installation is not a production install");
    expect(refusal(facts({ environment: { environmentClass: "production", declared: false } })))
      .toMatch(/installation is not a production install \(environment class undeclared\)/);
  });

  it("refuses unless the operating intent is a valid, confirmed evolve-dpf intent", () => {
    expect(refusal(facts({ intent: { status: "missing" } }))).toMatch(/operating intent is missing/);
    expect(refusal(facts({ intent: { status: "invalid", error: "bad" } }))).toMatch(/operating intent is invalid/);
    expect(refusal(facts({ intent: { ...confirmedIntent, intent: { ...confirmedIntent.intent, confirmation: { status: "needs-review" as never } } } })))
      .toMatch(/not confirmed/);
    expect(refusal(facts({ intent: { ...confirmedIntent, intent: { ...confirmedIntent.intent, primaryPurpose: "operate-organization" } } })))
      .toMatch(/operate-organization without evolve-dpf/);
  });
});

describe("installation purpose clause (DI-A6148958CADB)", () => {
  const purposes = (primaryPurpose: "evolve-dpf" | "operate-organization", secondaryPurposes: string[]) =>
    facts({ intent: { ...confirmedIntent, intent: { ...confirmedIntent.intent, primaryPurpose, secondaryPurposes: secondaryPurposes as never } } });

  it("passes when evolve-dpf is the primary purpose", () => {
    expect(evaluateIntakeControllerAuthority(purposes("evolve-dpf", [])).commissioned).toBe(true);
  });

  it("passes when evolve-dpf is a declared secondary purpose", () => {
    expect(evaluateIntakeControllerAuthority(purposes("operate-organization", ["evolve-dpf"])).commissioned).toBe(true);
  });

  it("fails when evolve-dpf is neither the primary nor a secondary purpose", () => {
    expect(refusal(purposes("operate-organization", ["grow-channel"])))
      .toBe("not commissioned: installation purpose is operate-organization without evolve-dpf as a secondary purpose");
  });

  it("still fails an unconfirmed intent that declares evolve-dpf as a secondary purpose", () => {
    const unconfirmed = purposes("operate-organization", ["evolve-dpf"]);
    const intent = unconfirmed.intent.status === "valid" ? unconfirmed.intent.intent : confirmedIntent.intent;
    expect(refusal({ ...unconfirmed, intent: { status: "valid", intent: { ...intent, confirmation: { status: "needs-review" } } } }))
      .toMatch(/not confirmed \(needs-review\)/);
  });
});

describe("evaluateIntakeControllerClauses", () => {
  const statuses = (input: IntakeControllerFacts) =>
    Object.fromEntries(evaluateIntakeControllerClauses(input).map((clause) => [clause.id, clause.status]));

  it("reports every clause, in predicate order, as passing for a commissioned controller", () => {
    const clauses = evaluateIntakeControllerClauses(facts());
    expect(clauses.map((clause) => clause.id)).toEqual([...INTAKE_CONTROLLER_CLAUSE_IDS]);
    expect(clauses.every((clause) => clause.status === "pass")).toBe(true);
  });

  it("reports independent failures together and leaves dependent clauses unchecked", () => {
    const input = facts({
      upstreamRemoteUrl: null,
      intent: { ...confirmedIntent, intent: { ...confirmedIntent.intent, primaryPurpose: "operate-organization" } },
    });
    expect(statuses(input)).toMatchObject({
      "upstream-configured": "fail",
      "room-repository": "unchecked",
      "commission-repository": "unchecked",
      "room-owner": "pass",
      purpose: "fail",
    });
  });

  it("leaves room clauses unchecked when no room was found", () => {
    expect(statuses(facts({ workroom: null }))).toMatchObject({
      "room-found": "fail",
      "room-live": "unchecked",
      "work-shape": "unchecked",
      "room-owner": "unchecked",
      "commissioner-owns": "unchecked",
      "production-install": "pass",
    });
  });

  it("keeps the verdict equal to the first failing clause", () => {
    const input = facts({ upstreamRemoteUrl: null, environment: { environmentClass: "development", declared: true } });
    const first = evaluateIntakeControllerClauses(input).find((clause) => clause.status === "fail");
    expect(first).toMatchObject({ id: "upstream-configured" });
    expect(evaluateIntakeControllerAuthority(input)).toEqual({
      commissioned: false,
      reason: `not commissioned: ${first && first.status === "fail" ? first.reason : ""}`,
    });
  });
});

function fakeDb(overrides: {
  metadata?: unknown;
  workroom?: unknown;
  peerMirror?: boolean;
  backlogBody?: string | null;
  upstreamRemoteUrl?: string | null;
} = {}) {
  const workroom = "workroom" in overrides ? overrides.workroom : { ...facts().workroom, backlogItemId: null, id: "row-1" };
  const db = {
    scheduledJob: {
      findUnique: vi.fn().mockResolvedValue(
        "metadata" in overrides ? { metadata: overrides.metadata } : { metadata: { lastEditedBy: "ops", [INTAKE_CONTROLLER_COMMISSION_KEY]: commission } },
      ),
      upsert: vi.fn().mockResolvedValue({}),
    },
    workroom: { findFirst: vi.fn().mockResolvedValue(workroom) },
    federatedRecordMirror: { findFirst: vi.fn().mockResolvedValue(overrides.peerMirror ? { mirrorId: "m-1" } : null) },
    backlogItem: { findFirst: vi.fn().mockResolvedValue(overrides.backlogBody === undefined ? null : { body: overrides.backlogBody }) },
    platformDevConfig: {
      findUnique: vi.fn().mockResolvedValue({
        upstreamRemoteUrl: "upstreamRemoteUrl" in overrides ? overrides.upstreamRemoteUrl : `https://github.com/${REPO}`,
      }),
    },
    platformConfig: { findUnique: vi.fn().mockResolvedValue({ value: confirmedIntent.intent }) },
  };
  return db as typeof db & IntakeControllerDb;
}

const production = async () => ({ environmentClass: "production", declared: true });

describe("loadIntakeControllerCommission", () => {
  it("resolves the commission recorded on the scheduled job", async () => {
    const db = fakeDb();
    expect(await loadIntakeControllerCommission({ db, loadEnvironment: production })).toMatchObject({
      commissioned: true, workroomCapsuleId: "WC-CONTROLLER",
    });
    expect(db.scheduledJob.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "ecosystem-inbound-issue-triage" } }));
  });

  it("treats a job row without the reference as uncommissioned without loading a workroom", async () => {
    const db = fakeDb({ metadata: { lastEditedBy: "ops" } });
    const verdict = await loadIntakeControllerCommission({ db, loadEnvironment: production });
    expect(verdict).toMatchObject({ commissioned: false, reason: expect.stringMatching(/^not commissioned: no controller workroom/) });
    expect(db.workroom.findFirst).not.toHaveBeenCalled();
  });

  it("flags a workroom bound to a federated-work mirror as peer-owned", async () => {
    const db = fakeDb({
      workroom: { ...facts().workroom, backlogItemId: "BI-PEER", id: "row-1" },
      backlogBody: "Peer item\n[origin:federatedWork:inst_peer:BI-PEER]",
    });
    expect(await loadIntakeControllerCommission({ db, loadEnvironment: production }))
      .toMatchObject({ commissioned: false, reason: expect.stringMatching(/peer-owned/) });
  });

  it("flags a workroom that a peer-canonical federated record mirrors", async () => {
    const db = fakeDb({ peerMirror: true });
    expect(await loadIntakeControllerCommission({ db, loadEnvironment: production }))
      .toMatchObject({ commissioned: false, reason: expect.stringMatching(/peer-owned/) });
    expect(db.federatedRecordMirror.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ canonicalSide: "peer" }),
    }));
  });

  it("refuses rather than falling back when the upstream URL is unset", async () => {
    const db = fakeDb({ upstreamRemoteUrl: null });
    expect(await loadIntakeControllerCommission({ db, loadEnvironment: production }))
      .toMatchObject({ commissioned: false, reason: expect.stringMatching(/no explicit upstream repository/) });
  });
});

describe("commissionIntakeController", () => {
  it("writes the commission through the merge helper, preserving existing metadata", async () => {
    const db = fakeDb({ metadata: { lastEditedBy: "ops", staleness: { consecutiveErrors: 1 } } });
    const now = new Date("2026-10-13T10:00:00.000Z");
    const result = await commissionIntakeController({
      workroomCapsuleId: "WC-CONTROLLER", principalRecordId: OWNER, db, loadEnvironment: production, now,
    });
    expect(result).toMatchObject({ ok: true });
    const call = db.scheduledJob.upsert.mock.calls[0]![0] as { update: { metadata: unknown }; create: { metadata: unknown; jobId: string } };
    expect(call.update.metadata).toMatchObject({ lastEditedBy: "ops", staleness: { consecutiveErrors: 1 } });
    expect(parseIntakeControllerCommission(call.update.metadata)).toEqual({
      ...commission, commissionedAt: now.toISOString(),
    });
    expect(call.create.jobId).toBe("ecosystem-inbound-issue-triage");
    expect(parseIntakeControllerCommission(call.create.metadata)).not.toBeNull();
  });

  it("refuses a principal who does not own the workroom and writes nothing", async () => {
    const db = fakeDb();
    const result = await commissionIntakeController({
      workroomCapsuleId: "WC-CONTROLLER", principalRecordId: "not-an-owner", db, loadEnvironment: production,
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/commissioning principal no longer owns/) });
    expect(db.scheduledJob.upsert).not.toHaveBeenCalled();
  });

  it("refuses a workroom that fails the controller predicate and writes nothing", async () => {
    const db = fakeDb({ workroom: { ...facts().workroom, status: "complete", backlogItemId: null, id: "row-1" } });
    const result = await commissionIntakeController({
      workroomCapsuleId: "WC-CONTROLLER", principalRecordId: OWNER, db, loadEnvironment: production,
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/is complete/) });
    expect(db.scheduledJob.upsert).not.toHaveBeenCalled();
  });

  it("refuses on a non-production installation", async () => {
    const db = fakeDb();
    const result = await commissionIntakeController({
      workroomCapsuleId: "WC-CONTROLLER", principalRecordId: OWNER, db,
      loadEnvironment: async () => ({ environmentClass: "development", declared: true }),
    });
    expect(result).toMatchObject({ ok: false, error: "not commissioned: installation is not a production install" });
    expect(db.scheduledJob.upsert).not.toHaveBeenCalled();
  });
});
