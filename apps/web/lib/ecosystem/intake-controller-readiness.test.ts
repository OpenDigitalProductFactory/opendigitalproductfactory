import { describe, expect, it, vi } from "vitest";

import type { IntakeControllerFacts } from "./intake-controller-authority";
import {
  appointIntakeControllerOwner,
  loadIntakeControllerReadiness,
  presentIntakeControllerReadiness,
  type IntakeControllerReadinessDb,
} from "./intake-controller-readiness";
import {
  INTAKE_CONTROLLER_COMMISSION_KEY,
  INTAKE_CONTROLLER_WORK_SHAPE,
  type IntakeControllerCommission,
} from "@/lib/operate/scheduled-jobs/intake-controller-commission";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
const VIEWER = "principal-row-viewer";
const AGENT = "principal-row-agent";

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

const agentCoordinator = {
  principalId: AGENT, roles: ["coordinator"], lifecycle: "active", principal: { kind: "agent", status: "active" },
};
const viewerOwner = {
  principalId: VIEWER, roles: ["coordinator"], lifecycle: "active", principal: { kind: "human", status: "active" },
};

const room = (participants = [agentCoordinator]) => ({
  capsuleId: "WC-STANDING",
  status: "draft",
  archivedAt: null,
  repositoryFullName: REPO,
  scopeClaims: [{ workShape: INTAKE_CONTROLLER_WORK_SHAPE, recordedAt: "2026-10-01T00:00:00.000Z" }],
  participants,
});

const candidate = (principalId = VIEWER): IntakeControllerCommission => ({
  workroomCapsuleId: "WC-STANDING",
  repositoryFullName: REPO,
  workShape: INTAKE_CONTROLLER_WORK_SHAPE,
  commissionedByPrincipalId: principalId,
  commissionedAt: "2026-10-21T00:00:00.000Z",
});

const facts = (overrides: Partial<IntakeControllerFacts> = {}): IntakeControllerFacts => ({
  commission: candidate(),
  workroom: room([viewerOwner]),
  mirroredFromPeer: false,
  upstreamRemoteUrl: `https://github.com/${REPO}`,
  intent: confirmedIntent,
  environment: { environmentClass: "production", declared: true },
  ...overrides,
});

const names = { [VIEWER]: "Mark", [AGENT]: "Issue triage coordinator" };

describe("presentIntakeControllerReadiness", () => {
  it("lists one checklist row per clause, without the not-yet-written commission reference", () => {
    const view = presentIntakeControllerReadiness({
      candidateFacts: facts(), recorded: null, viewerPrincipalRecordId: VIEWER, principalNames: names,
    });
    expect(view.rows.map((row) => row.id)).not.toContain("commission");
    expect(view.rows).toHaveLength(12);
    expect(view.rows.every((row) => row.status === "pass")).toBe(true);
    expect(view.blocking).toBeNull();
    expect(view.canCommission).toBe(true);
    expect(view.viewerIsOwner).toBe(true);
    expect(view.ownership.canBecomeOwner).toBe(false);
  });

  it("names the first failing clause as the reason Commission is unavailable", () => {
    const view = presentIntakeControllerReadiness({
      candidateFacts: facts({ upstreamRemoteUrl: null }), recorded: null, viewerPrincipalRecordId: VIEWER, principalNames: names,
    });
    expect(view.canCommission).toBe(false);
    expect(view.blocking).toMatchObject({ id: "upstream-configured", reason: expect.stringMatching(/no explicit upstream/) });
    expect(view.rows.find((row) => row.id === "room-repository")).toMatchObject({ status: "unchecked", reason: null });
  });

  it("offers ownership to a viewer who is not an owner and names the coordinator it hands over from", () => {
    const view = presentIntakeControllerReadiness({
      candidateFacts: facts({ workroom: room() }), recorded: null, viewerPrincipalRecordId: VIEWER, principalNames: names,
    });
    expect(view.viewerIsOwner).toBe(false);
    expect(view.ownership).toEqual({ canBecomeOwner: true, handsOverFrom: ["Issue triage coordinator"] });
    expect(view.blocking).toMatchObject({
      id: "commissioner-owns",
      reason: "you are not an active accountable or coordinator owner of workroom WC-STANDING",
    });
  });

  it("does not offer ownership to a viewer without an active person record", () => {
    const view = presentIntakeControllerReadiness({
      candidateFacts: facts({ workroom: room(), commission: candidate("") }), recorded: null,
      viewerPrincipalRecordId: null, principalNames: names,
    });
    expect(view.ownership.canBecomeOwner).toBe(false);
    expect(view.rows.find((row) => row.id === "commissioner-owns")?.reason).toMatch(/no active person record/);
  });

  it("does not offer ownership of a room that cannot be the controller", () => {
    const view = presentIntakeControllerReadiness({
      candidateFacts: facts({ workroom: { ...room(), status: "complete" } }), recorded: null,
      viewerPrincipalRecordId: VIEWER, principalNames: names,
    });
    expect(view.ownership.canBecomeOwner).toBe(false);
  });

  it("explains a missing standing room plainly and still checks the installation clauses", () => {
    const view = presentIntakeControllerReadiness({
      candidateFacts: facts({ workroom: null, commission: { ...candidate(), workroomCapsuleId: "" } }), recorded: null,
      viewerPrincipalRecordId: VIEWER, principalNames: names,
    });
    expect(view.room).toBeNull();
    expect(view.rows.find((row) => row.id === "room-found")?.reason).toMatch(/no live issue-triage-watch@1\.0\.0 room/);
    expect(view.rows.find((row) => row.id === "production-install")?.status).toBe("pass");
    expect(view.canCommission).toBe(false);
  });

  it("shows a recorded commission that still holds as commissioned, with who and when", () => {
    const recorded = { ...candidate(), commissionedAt: "2026-10-20T08:00:00.000Z" };
    const view = presentIntakeControllerReadiness({
      candidateFacts: facts(), recorded, viewerPrincipalRecordId: VIEWER, principalNames: names,
    });
    expect(view.commission).toEqual({
      workroomCapsuleId: "WC-STANDING",
      repositoryFullName: REPO,
      commissionedBy: "Mark",
      commissionedAt: "2026-10-20T08:00:00.000Z",
      holds: true,
      reason: null,
    });
  });

  it("shows a recorded commission that lost its authority with the predicate's reason", () => {
    const recorded = { ...candidate(AGENT) };
    const view = presentIntakeControllerReadiness({
      candidateFacts: facts(), recorded, viewerPrincipalRecordId: VIEWER, principalNames: names,
    });
    expect(view.commission).toMatchObject({
      holds: false, commissionedBy: "Issue triage coordinator",
      reason: expect.stringMatching(/^not commissioned: the commissioning principal no longer owns/),
    });
  });
});

function fakeDb(overrides: { metadata?: unknown; rooms?: unknown[]; roomById?: unknown } = {}) {
  const standing = { ...room(), id: "row-standing", backlogItemId: null };
  const db = {
    scheduledJob: {
      findUnique: vi.fn().mockResolvedValue({ metadata: overrides.metadata ?? { lastEditedBy: "ops" } }),
      upsert: vi.fn(),
    },
    workroom: {
      findMany: vi.fn().mockResolvedValue(overrides.rooms ?? [{ capsuleId: "WC-OTHER", scopeClaims: [] }, standing]),
      findFirst: vi.fn().mockResolvedValue("roomById" in overrides ? overrides.roomById : standing),
    },
    federatedRecordMirror: { findFirst: vi.fn().mockResolvedValue(null) },
    backlogItem: { findFirst: vi.fn().mockResolvedValue(null) },
    platformDevConfig: { findUnique: vi.fn().mockResolvedValue({ upstreamRemoteUrl: null }) },
    platformConfig: { findUnique: vi.fn().mockResolvedValue({ value: confirmedIntent.intent }) },
    principal: {
      findMany: vi.fn().mockResolvedValue([{ id: AGENT, displayName: "Issue triage coordinator" }]),
    },
  };
  return db as typeof db & IntakeControllerReadinessDb;
}

const production = async () => ({ environmentClass: "production", declared: true });

describe("loadIntakeControllerReadiness", () => {
  it("finds the live standing issue-triage room by its key and work shape when nothing is commissioned", async () => {
    const db = fakeDb();
    const view = await loadIntakeControllerReadiness({ viewerPrincipalRecordId: VIEWER, db, loadEnvironment: production });
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        idempotencyKey: { startsWith: "standing-room:issue-triage" },
        archivedAt: null,
      }),
    }));
    expect(view.room).toEqual({ capsuleId: "WC-STANDING", status: "draft", repositoryFullName: REPO });
    expect(view.ownership).toEqual({ canBecomeOwner: true, handsOverFrom: ["Issue triage coordinator"] });
    expect(view.blocking).toMatchObject({ id: "upstream-configured" });
  });

  it("reports no room when no standing room declares the controller work shape", async () => {
    const db = fakeDb({ rooms: [{ capsuleId: "WC-OTHER", scopeClaims: [] }] });
    const view = await loadIntakeControllerReadiness({ viewerPrincipalRecordId: VIEWER, db, loadEnvironment: production });
    expect(view.room).toBeNull();
    expect(db.workroom.findFirst).not.toHaveBeenCalled();
    expect(view.rows.find((row) => row.id === "room-found")?.status).toBe("fail");
  });

  it("reads the commission recorded on the scheduled job and checks that room", async () => {
    const db = fakeDb({ metadata: { [INTAKE_CONTROLLER_COMMISSION_KEY]: candidate(AGENT) } });
    const view = await loadIntakeControllerReadiness({ viewerPrincipalRecordId: VIEWER, db, loadEnvironment: production });
    expect(db.workroom.findMany).not.toHaveBeenCalled();
    expect(view.commission).toMatchObject({ workroomCapsuleId: "WC-STANDING", holds: false });
  });
});

describe("appointIntakeControllerOwner", () => {
  const deps = () => ({
    loadReadiness: vi.fn().mockResolvedValue(presentIntakeControllerReadiness({
      candidateFacts: facts({ workroom: room() }), recorded: null, viewerPrincipalRecordId: VIEWER, principalNames: names,
    })),
    accessRefusal: vi.fn().mockResolvedValue(null),
    resolvePrincipalRef: vi.fn().mockResolvedValue("PRN-VIEWER"),
    appoint: vi.fn().mockResolvedValue({ ok: true, data: { capsuleId: "WC-STANDING", principalRef: "PRN-VIEWER", displayName: "Mark" } }),
    recordActivity: vi.fn().mockResolvedValue(undefined),
  });

  it("appoints the operator through the governed coordinator writer and records it on the room", async () => {
    const d = deps();
    const result = await appointIntakeControllerOwner({ capsuleId: "WC-STANDING", userId: "user-1", principalRecordId: VIEWER, ...d });
    expect(result).toEqual({ ok: true, data: "Mark now owns WC-STANDING." });
    expect(d.accessRefusal).toHaveBeenCalledWith({ capsuleId: "WC-STANDING", userId: "user-1" });
    expect(d.appoint).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-STANDING", principalRef: "PRN-VIEWER", replaceExisting: true, reason: expect.stringMatching(/issue intake/),
    }));
    expect(d.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      capsuleId: "WC-STANDING", userId: "user-1", summary: expect.stringMatching(/Mark took ownership/),
    }));
  });

  it("refuses a room that is not the intake controller candidate", async () => {
    const d = deps();
    const result = await appointIntakeControllerOwner({ capsuleId: "WC-ELSEWHERE", userId: "user-1", principalRecordId: VIEWER, ...d });
    expect(result).toMatchObject({ ok: false });
    expect(d.appoint).not.toHaveBeenCalled();
  });

  it("refuses when the governed appointment access check refuses", async () => {
    const d = deps();
    d.accessRefusal.mockResolvedValue({ success: false, error: "workroom_access_denied", message: "Not admitted." });
    const result = await appointIntakeControllerOwner({ capsuleId: "WC-STANDING", userId: "user-1", principalRecordId: VIEWER, ...d });
    expect(result).toEqual({ ok: false, error: "Not admitted." });
    expect(d.appoint).not.toHaveBeenCalled();
  });

  it("reports the writer's refusal and records nothing", async () => {
    const d = deps();
    d.appoint.mockResolvedValue({ ok: false, error: "principal_not_found: no active principal PRN-VIEWER." });
    const result = await appointIntakeControllerOwner({ capsuleId: "WC-STANDING", userId: "user-1", principalRecordId: VIEWER, ...d });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/principal_not_found/) });
    expect(d.recordActivity).not.toHaveBeenCalled();
  });
});
