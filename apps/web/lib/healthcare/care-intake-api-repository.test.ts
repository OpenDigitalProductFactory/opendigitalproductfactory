import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCareIntakeSavedResponse,
  getCareIntakePacketProjection,
  issueCareIntakeResumeGrant,
  saveCareIntakePartialResponse,
  submitCareIntakePacket,
  type CareIntakeApiDatabase,
} from "./care-intake-api-repository";
import { digestCareIntakeResumeToken } from "./care-intake-access";

// Resume grants are rejected at issue time unless the expiry is still ahead of
// `Date.now()`, so this has to be relative — a fixed instant turns every test
// below into a time bomb that detonates once the clock passes it.
const grantExpiry = () => new Date(Date.now() + 60 * 60 * 1000);

const packet = {
  id: "packet-row-a",
  packetId: "intake-a",
  organizationId: "org-a",
  patientProfileId: "patient-a",
  status: "assigned",
  version: 1,
  dueAt: null,
  completionPercent: 0,
  purposeOfUse: "patient-intake",
  allowedDataCategories: ["visit-reason"],
  requirementSnapshot: [
    {
      dynamicFormId: "form-row-a",
      dynamicFormVersion: 2,
      linkId: "visit-reason",
      dataCategory: "visit-reason",
      required: true,
    },
  ],
  requiredConsentCount: 0,
  requiresCoverageEvidence: false,
};

function database() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    careIntakePacket: {
      findFirst: vi.fn().mockResolvedValue(packet),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    careIntakeAccessGrant: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    dynamicForm: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "form-row-a",
          formId: "medical-history",
          title: "Medical history",
          version: 2,
          fields: [{ key: "visit-reason", type: "textarea", label: "Reason" }],
          submitAction: null,
          offlineCapable: true,
        },
      ]),
      findFirst: vi.fn().mockResolvedValue({
        id: "form-row-a",
        formId: "medical-history",
        title: "Medical history",
        version: 2,
        fields: [{ key: "visit-reason", type: "textarea", label: "Reason" }],
        submitAction: null,
        offlineCapable: true,
      }),
    },
    careIntakeResponse: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...data, id: "response-row-a", version: 1 }),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    careIntakeException: { count: vi.fn().mockResolvedValue(0) },
    careConsentAttestation: { count: vi.fn().mockResolvedValue(0) },
    careCoverageEvidence: { count: vi.fn().mockResolvedValue(0) },
    careIntakeStatusEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn((callback) => callback(tx)),
    } as unknown as CareIntakeApiDatabase,
  };
}

describe("issueCareIntakeResumeGrant", () => {
  // Pinned like every other block in this file. Without it the suite reads the real
  // clock while its fixtures carry a fixed `expiresAt`, so the test passes only until
  // that instant and then fails forever — which is exactly what happened at
  // 2026-08-01T15:00Z.
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"));
  afterEach(() => vi.useRealTimers());

  it("issues the raw token once only after an allow decision", async () => {
    const { db, tx } = database();
    const result = await issueCareIntakeResumeGrant(
      {
        organizationId: "org-a",
        patientProfileId: "patient-a",
        patientPrincipalId: "principal-patient-a",
        packetId: "intake-a",
        granteePrincipalId: "principal-patient-a",
        issuedByPrincipalId: "principal-patient-a",
        permittedOperations: ["view", "save", "submit"],
        expiresAt: grantExpiry(),
        authorityDecision: { effect: "allow", reasonCodes: ["patient-self-access"] },
      },
      db,
    );

    expect(result.token).toBeTruthy();
    expect(tx.careIntakeAccessGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenDigest: digestCareIntakeResumeToken(result.token),
        packetId: "packet-row-a",
        patientProfileId: "patient-a",
        granteePrincipalId: "principal-patient-a",
      }),
    });
  });

  it("does not mint a token after a denied authority decision", async () => {
    const { db, tx } = database();
    await expect(
      issueCareIntakeResumeGrant(
        {
          organizationId: "org-a",
          patientProfileId: "patient-a",
          patientPrincipalId: "principal-patient-a",
          packetId: "intake-a",
          granteePrincipalId: "principal-proxy",
          issuedByPrincipalId: "principal-proxy",
          permittedOperations: ["view"],
          expiresAt: grantExpiry(),
          authorityDecision: { effect: "deny", reasonCodes: ["authority-not-found"] },
        },
        db,
      ),
    ).rejects.toThrow("Patient authority denied care intake access");
    expect(tx.careIntakeAccessGrant.create).not.toHaveBeenCalled();
  });
});

describe("submitCareIntakePacket", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"));

  async function submitFixture() {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant({
      organizationId: "org-a", patientProfileId: "patient-a", patientPrincipalId: "principal-patient-a",
      packetId: "intake-a", granteePrincipalId: "principal-patient-a", issuedByPrincipalId: "principal-patient-a",
      permittedOperations: ["submit"], expiresAt: grantExpiry(),
      authorityDecision: { effect: "allow", reasonCodes: [] },
    }, db);
    tx.careIntakePacket.findFirst.mockResolvedValue({ ...packet, status: "in-progress", version: 2 });
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId, packetId: "packet-row-a", patientProfileId: "patient-a",
      granteePrincipalId: "principal-patient-a", tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["submit"], expiresAt: grantExpiry(), revokedAt: null,
    });
    return { db, tx, token: issued.token };
  }

  it("rejects incomplete intake without advancing packet state", async () => {
    const { db, tx, token } = await submitFixture();

    const result = await submitCareIntakePacket({
      packetId: "intake-a", token, expectedVersion: 2, sourceMode: "patient-web",
    }, db);

    expect(result).toEqual({
      ok: false,
      blockers: ["required-answers-missing"],
      missingRequiredLinkIds: ["visit-reason"],
      completionPercent: 50,
    });
    expect(tx.careIntakePacket.updateMany).not.toHaveBeenCalled();
  });

  it("completes a ready packet and records its optimistic lifecycle event", async () => {
    const { db, tx, token } = await submitFixture();
    tx.careIntakeResponse.findMany.mockResolvedValue([{ answeredLinkIds: ["visit-reason"] }]);

    const result = await submitCareIntakePacket({
      packetId: "intake-a", token, expectedVersion: 2, sourceMode: "patient-web",
    }, db);

    expect(result).toEqual({
      ok: true, packetId: "intake-a", status: "completed", version: 3, completionPercent: 100,
    });
    expect(tx.careIntakePacket.updateMany).toHaveBeenCalledWith({
      where: {
        id: "packet-row-a", organizationId: "org-a", status: "in-progress", version: 2,
      },
      data: expect.objectContaining({
        status: "completed", version: 3, completionPercent: 100,
        completedAt: new Date("2026-08-01T14:00:00.000Z"),
      }),
    });
    expect(tx.careIntakeResponse.updateMany).toHaveBeenCalledWith({
      where: { packetId: "packet-row-a", organizationId: "org-a", status: "in-progress" },
      data: { status: "completed", completedAt: new Date("2026-08-01T14:00:00.000Z") },
    });
    expect(tx.careIntakeStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        packetVersion: 3, fromStatus: "in-progress", toStatus: "completed",
        reason: "patient-submitted", actorPrincipalId: "principal-patient-a",
      }),
    });
  });
});

describe("saveCareIntakePartialResponse", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"));

  it("saves a minimum-necessary partial response without echoing answers", async () => {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant(
      {
        organizationId: "org-a",
        patientProfileId: "patient-a",
        patientPrincipalId: "principal-patient-a",
        packetId: "intake-a",
        granteePrincipalId: "principal-patient-a",
        issuedByPrincipalId: "principal-patient-a",
        permittedOperations: ["save"],
        expiresAt: grantExpiry(),
        authorityDecision: { effect: "allow", reasonCodes: [] },
      },
      db,
    );
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId,
      packetId: "packet-row-a",
      patientProfileId: "patient-a",
      granteePrincipalId: "principal-patient-a",
      tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["save"],
      expiresAt: grantExpiry(),
      revokedAt: null,
    });

    const result = await saveCareIntakePartialResponse(
      {
        packetId: "intake-a",
        formId: "medical-history",
        token: issued.token,
        idempotencyKey: "device-a-save-1",
        expectedVersion: null,
        sourceMode: "patient-web",
        answers: { "visit-reason": "Routine check" },
        dataCategories: { "visit-reason": "visit-reason" },
      },
      db,
    );

    expect(result).toEqual({
      responseId: expect.stringMatching(/^intake-response-/),
      status: "in-progress",
      version: 1,
      answeredLinkIds: ["visit-reason"],
    });
    expect(JSON.stringify(result)).not.toContain("Routine check");
    expect(tx.careIntakeResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceSystem: "care-intake-api",
        sourceId: "packet-row-a:form-row-a",
        sourceVersion: "device-a-save-1",
        recordedByPrincipalId: "principal-patient-a",
      }),
    });
    expect(tx.careIntakePacket.updateMany).toHaveBeenCalledWith({
      where: {
        id: "packet-row-a",
        organizationId: "org-a",
        status: "assigned",
        version: 1,
      },
      data: expect.objectContaining({
        status: "in-progress",
        version: 2,
        startedAt: new Date("2026-08-01T14:00:00.000Z"),
      }),
    });
    expect(tx.careIntakeStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        packetVersion: 2,
        fromStatus: "assigned",
        toStatus: "in-progress",
        reason: "first-response-saved",
        actorPrincipalId: "principal-patient-a",
      }),
    });
  });

  it("does not count empty partial values as answered requirements", async () => {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant({
      organizationId: "org-a", patientProfileId: "patient-a", patientPrincipalId: "principal-patient-a",
      packetId: "intake-a", granteePrincipalId: "principal-patient-a", issuedByPrincipalId: "principal-patient-a",
      permittedOperations: ["save"], expiresAt: grantExpiry(),
      authorityDecision: { effect: "allow", reasonCodes: [] },
    }, db);
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId, packetId: "packet-row-a", patientProfileId: "patient-a",
      granteePrincipalId: "principal-patient-a", tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["save"], expiresAt: grantExpiry(), revokedAt: null,
    });

    const result = await saveCareIntakePartialResponse({
      packetId: "intake-a", formId: "medical-history", token: issued.token,
      idempotencyKey: "device-a-empty-1", expectedVersion: null, sourceMode: "patient-web",
      answers: { "visit-reason": "   " }, dataCategories: { "visit-reason": "visit-reason" },
    }, db);

    expect(result.answeredLinkIds).toEqual([]);
    expect(tx.careIntakeResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ answeredLinkIds: [] }),
    });
  });

  it("returns an idempotent result without rewriting the response", async () => {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant({
      organizationId: "org-a", patientProfileId: "patient-a", patientPrincipalId: "principal-patient-a",
      packetId: "intake-a", granteePrincipalId: "principal-patient-a", issuedByPrincipalId: "principal-patient-a",
      permittedOperations: ["save"], expiresAt: grantExpiry(),
      authorityDecision: { effect: "allow", reasonCodes: [] },
    }, db);
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId, packetId: "packet-row-a", patientProfileId: "patient-a",
      granteePrincipalId: "principal-patient-a", tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["save"], expiresAt: grantExpiry(), revokedAt: null,
    });
    tx.careIntakeResponse.findFirst.mockResolvedValue({
      id: "response-row-a", responseId: "intake-response-a", version: 3,
      sourceVersion: "device-a-save-3", answeredLinkIds: ["visit-reason"],
    });
    tx.careIntakePacket.findFirst.mockResolvedValue({ ...packet, status: "in-progress", version: 2 });

    const result = await saveCareIntakePartialResponse({
      packetId: "intake-a", formId: "medical-history", token: issued.token,
      idempotencyKey: "device-a-save-3", expectedVersion: 2, sourceMode: "patient-web",
      answers: { "visit-reason": "Routine" }, dataCategories: { "visit-reason": "visit-reason" },
    }, db);

    expect(result).toEqual({
      responseId: "intake-response-a", status: "in-progress", version: 3,
      answeredLinkIds: ["visit-reason"],
    });
    expect(tx.careIntakeResponse.updateMany).not.toHaveBeenCalled();
    expect(tx.careIntakePacket.updateMany).not.toHaveBeenCalled();
  });

  it("rejects answer categories outside the packet scope", async () => {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant(
      {
        organizationId: "org-a", patientProfileId: "patient-a", patientPrincipalId: "principal-patient-a",
        packetId: "intake-a", granteePrincipalId: "principal-patient-a", issuedByPrincipalId: "principal-patient-a",
        permittedOperations: ["save"], expiresAt: grantExpiry(),
        authorityDecision: { effect: "allow", reasonCodes: [] },
      }, db,
    );
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId, packetId: "packet-row-a", patientProfileId: "patient-a",
      granteePrincipalId: "principal-patient-a", tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["save"], expiresAt: grantExpiry(), revokedAt: null,
    });
    await expect(saveCareIntakePartialResponse({
      packetId: "intake-a", formId: "medical-history", token: issued.token,
      idempotencyKey: "device-a-save-2", expectedVersion: null, sourceMode: "patient-web",
      answers: { "visit-reason": "Routine", extra: "secret" },
      dataCategories: { "visit-reason": "visit-reason", extra: "clinical-note" },
    }, db)).rejects.toThrow("data-category-not-authorized:extra");
    expect(tx.careIntakeResponse.create).not.toHaveBeenCalled();
  });
});

describe("getCareIntakePacketProjection", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"));

  it("returns only lifecycle/readiness and packet-pinned form definitions", async () => {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant(
      {
        organizationId: "org-a",
        patientProfileId: "patient-a",
        patientPrincipalId: "principal-patient-a",
        packetId: "intake-a",
        granteePrincipalId: "principal-patient-a",
        issuedByPrincipalId: "principal-patient-a",
        permittedOperations: ["view"],
        expiresAt: grantExpiry(),
        authorityDecision: { effect: "allow", reasonCodes: [] },
      },
      db,
    );
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId,
      packetId: "packet-row-a",
      patientProfileId: "patient-a",
      tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["view"],
      expiresAt: grantExpiry(),
      revokedAt: null,
    });

    const projection = await getCareIntakePacketProjection(
      { packetId: "intake-a", token: issued.token },
      db,
    );

    expect(projection).toEqual({
      packetId: "intake-a",
      status: "assigned",
      version: 1,
      dueAt: null,
      completionPercent: 0,
      forms: [
        expect.objectContaining({
          formId: "medical-history",
          version: 2,
          dataCategories: { "visit-reason": "visit-reason" },
        }),
      ],
    });
    expect(JSON.stringify(projection)).not.toContain("answers");
    expect(tx.dynamicForm.findMany).toHaveBeenCalledWith({
      where: { OR: [{ id: "form-row-a", version: 2 }] },
    });
  });
});

describe("getCareIntakeSavedResponse", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"));

  it("returns saved answers only to a view-scoped patient grant", async () => {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant({
      organizationId: "org-a", patientProfileId: "patient-a", patientPrincipalId: "principal-patient-a",
      packetId: "intake-a", granteePrincipalId: "principal-patient-a", issuedByPrincipalId: "principal-patient-a",
      permittedOperations: ["view"], expiresAt: grantExpiry(),
      authorityDecision: { effect: "allow", reasonCodes: [] },
    }, db);
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId, packetId: "packet-row-a", patientProfileId: "patient-a",
      granteePrincipalId: "principal-patient-a", tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["view"], expiresAt: grantExpiry(), revokedAt: null,
    });
    tx.careIntakeResponse.findFirst.mockResolvedValue({
      id: "response-row-a", responseId: "response-a", version: 2,
      sourceVersion: "save-a", answeredLinkIds: ["visit-reason"],
      answers: { "visit-reason": "Routine check" }, status: "in-progress",
    });

    await expect(getCareIntakeSavedResponse({
      packetId: "intake-a", formId: "medical-history", token: issued.token,
    }, db)).resolves.toEqual({
      responseId: "response-a", version: 2, status: "in-progress",
      answers: { "visit-reason": "Routine check" }, answeredLinkIds: ["visit-reason"],
    });
  });

  it("returns an empty response shape before the first save", async () => {
    const { db, tx } = database();
    const issued = await issueCareIntakeResumeGrant({
      organizationId: "org-a", patientProfileId: "patient-a", patientPrincipalId: "principal-patient-a",
      packetId: "intake-a", granteePrincipalId: "principal-patient-a", issuedByPrincipalId: "principal-patient-a",
      permittedOperations: ["view"], expiresAt: grantExpiry(),
      authorityDecision: { effect: "allow", reasonCodes: [] },
    }, db);
    tx.careIntakeAccessGrant.findFirst.mockResolvedValue({
      grantId: issued.grantId, packetId: "packet-row-a", patientProfileId: "patient-a",
      granteePrincipalId: "principal-patient-a", tokenDigest: digestCareIntakeResumeToken(issued.token),
      permittedOperations: ["view"], expiresAt: grantExpiry(), revokedAt: null,
    });

    await expect(getCareIntakeSavedResponse({
      packetId: "intake-a", formId: "medical-history", token: issued.token,
    }, db)).resolves.toEqual({ responseId: null, version: null, status: "not-started", answers: {}, answeredLinkIds: [] });
  });
});
