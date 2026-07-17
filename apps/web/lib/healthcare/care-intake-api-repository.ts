import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";
import {
  calculateIntakeReadiness,
  requirementsForPinnedForm,
  validateMinimumNecessaryAnswers,
  type CareIntakeRequirement,
  type CareIntakeSourceMode,
} from "@dpf/db/healthcare-care-intake";

import {
  assertCareIntakeGrant,
  CARE_INTAKE_GRANT_OPERATIONS,
  createCareIntakeResumeToken,
  digestCareIntakeResumeToken,
  parseCareIntakeResumeToken,
  type CareIntakeGrantOperation,
} from "./care-intake-access";
import { evaluateAndRecordPatientAuthority } from "./patient-authority-repository";

type PacketRow = {
  id: string;
  packetId: string;
  organizationId: string;
  patientProfileId: string;
  status: string;
  version: number;
  dueAt: Date | null;
  completionPercent: number;
  purposeOfUse: string;
  requirementSnapshot: unknown;
  requiredConsentCount: number;
  requiresCoverageEvidence: boolean;
  allowedDataCategories: string[];
};

type GrantRow = {
  grantId: string;
  packetId: string;
  patientProfileId: string;
  tokenDigest: string;
  permittedOperations: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  granteePrincipalId: string | null;
};

type DynamicFormRow = {
  id: string;
  formId: string;
  title: string;
  version: number;
  fields: unknown;
  submitAction: string | null;
  offlineCapable: boolean;
};

type Transaction = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  careIntakePacket: {
    findFirst(args: unknown): Promise<PacketRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  careIntakeAccessGrant: {
    create(args: unknown): Promise<GrantRow>;
    findFirst(args: unknown): Promise<GrantRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  dynamicForm: {
    findMany(args: unknown): Promise<DynamicFormRow[]>;
    findFirst(args: unknown): Promise<DynamicFormRow | null>;
  };
  careIntakeResponse: {
    findFirst(args: unknown): Promise<{
      id: string;
      responseId: string;
      version: number;
      sourceVersion: string | null;
      answeredLinkIds: string[];
      answers?: unknown;
      status?: string;
    } | null>;
    findMany(args: unknown): Promise<Array<{ answeredLinkIds: string[] }>>;
    create(args: unknown): Promise<{
      responseId: string;
      version: number;
      answeredLinkIds: string[];
    }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  careIntakeException: { count(args: unknown): Promise<number> };
  careConsentAttestation: { count(args: unknown): Promise<number> };
  careCoverageEvidence: { count(args: unknown): Promise<number> };
  careIntakeStatusEvent: { create(args: unknown): Promise<unknown> };
};

export type CareIntakeApiDatabase = {
  $transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
};

function hasSubstantiveAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasSubstantiveAnswer);
  if (typeof value === "object") return Object.values(value).some(hasSubstantiveAnswer);
  return true;
}

function packetRequirements(value: unknown): CareIntakeRequirement[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Invalid intake requirement snapshot");
  }
  for (const requirement of value) {
    if (
      !requirement
      || typeof requirement !== "object"
      || typeof requirement.dynamicFormId !== "string"
      || !Number.isInteger(requirement.dynamicFormVersion)
      || requirement.dynamicFormVersion < 1
      || typeof requirement.linkId !== "string"
      || typeof requirement.dataCategory !== "string"
      || typeof requirement.required !== "boolean"
    ) {
      throw new Error("Invalid intake requirement snapshot");
    }
  }
  return value as CareIntakeRequirement[];
}

async function setPatientContext(
  tx: Transaction,
  input: { organizationId: string; patientProfileId: string },
) {
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${input.organizationId}, true), set_config('app.patient_profile_ids', ${input.patientProfileId}, true)`;
}

function validateOperations(
  operations: CareIntakeGrantOperation[],
): CareIntakeGrantOperation[] {
  const unique = [...new Set(operations)];
  if (
    unique.length === 0
    || unique.some(
      (operation) => !CARE_INTAKE_GRANT_OPERATIONS.includes(operation),
    )
  ) {
    throw new Error("Invalid care intake grant operations");
  }
  return unique;
}

async function markPacketInProgressAfterFirstSave(
  tx: Transaction,
  packet: PacketRow,
  input: { sourceMode: CareIntakeSourceMode; actorPrincipalId: string },
) {
  if (packet.status !== "assigned") return;
  const version = packet.version + 1;
  const updated = await tx.careIntakePacket.updateMany({
    where: {
      id: packet.id,
      organizationId: packet.organizationId,
      status: "assigned",
      version: packet.version,
    },
    data: {
      status: "in-progress",
      version,
      startedAt: new Date(),
    },
  });
  if (updated.count !== 1) throw new Error("stale-intake-packet-version");
  await tx.careIntakeStatusEvent.create({
    data: {
      eventId: `intake-event-${randomUUID()}`,
      organizationId: packet.organizationId,
      packetId: packet.id,
      patientProfileId: packet.patientProfileId,
      packetVersion: version,
      fromStatus: "assigned",
      toStatus: "in-progress",
      reason: "first-response-saved",
      sourceMode: input.sourceMode,
      actorPrincipalId: input.actorPrincipalId,
    },
  });
}

export async function issueCareIntakeResumeGrant(
  input: {
    organizationId: string;
    patientProfileId: string;
    patientPrincipalId: string;
    packetId: string;
    granteePrincipalId: string;
    issuedByPrincipalId: string;
    permittedOperations: CareIntakeGrantOperation[];
    expiresAt: Date;
    authorityDecision: { effect: "allow" | "deny"; reasonCodes: string[] };
  },
  database: CareIntakeApiDatabase = prisma as unknown as CareIntakeApiDatabase,
) {
  if (input.authorityDecision.effect !== "allow") {
    throw new Error("Patient authority denied care intake access");
  }
  if (input.expiresAt.getTime() <= Date.now()) {
    throw new Error("Care intake grant expiry must be in the future");
  }
  const permittedOperations = validateOperations(input.permittedOperations);

  return database.$transaction(async (tx) => {
    await setPatientContext(tx, input);
    const packet = await tx.careIntakePacket.findFirst({
      where: {
        packetId: input.packetId,
        organizationId: input.organizationId,
        patientProfileId: input.patientProfileId,
        patientProfile: { principalId: input.patientPrincipalId },
      },
    });
    if (!packet) throw new Error("Care intake packet not found");
    if (["entered-in-error", "stopped"].includes(packet.status)) {
      throw new Error("Care intake packet does not accept access grants");
    }

    const grantId = `intake-grant-${randomUUID()}`;
    const issued = createCareIntakeResumeToken({
      organizationId: input.organizationId,
      patientProfileId: input.patientProfileId,
      grantId,
    });
    await tx.careIntakeAccessGrant.create({
      data: {
        grantId,
        organizationId: input.organizationId,
        packetId: packet.id,
        patientProfileId: input.patientProfileId,
        tokenDigest: issued.digest,
        granteePrincipalId: input.granteePrincipalId,
        permittedOperations,
        issuedByPrincipalId: input.issuedByPrincipalId,
        expiresAt: input.expiresAt,
      },
    });
    return {
      grantId,
      token: issued.token,
      expiresAt: input.expiresAt,
      permittedOperations,
    };
  });
}

export async function authorizeAndIssueCareIntakeResumeGrant(
  input: {
    organizationId: string;
    patientProfileId: string;
    patientPrincipalId: string;
    packetId: string;
    actorPrincipalId: string;
    permittedOperations: CareIntakeGrantOperation[];
    expiresAt: Date;
  },
  options: {
    database?: CareIntakeApiDatabase;
    evaluateAuthority?: typeof evaluateAndRecordPatientAuthority;
  } = {},
) {
  const database =
    options.database ?? (prisma as unknown as CareIntakeApiDatabase);
  const packet = await database.$transaction(async (tx) => {
    await setPatientContext(tx, input);
    return tx.careIntakePacket.findFirst({
      where: {
        packetId: input.packetId,
        organizationId: input.organizationId,
        patientProfileId: input.patientProfileId,
        patientProfile: { principalId: input.patientPrincipalId },
      },
    });
  });
  if (!packet) throw new Error("Care intake packet not found");
  const evaluateAuthority =
    options.evaluateAuthority ?? evaluateAndRecordPatientAuthority;
  const authorityDecision = await evaluateAuthority({
    organizationId: input.organizationId,
    actorPrincipalId: input.actorPrincipalId,
    actorType: "human",
    patientPrincipalId: input.patientPrincipalId,
    purposeOfUse: packet.purposeOfUse,
    operation: "create",
    recordCategory: "care-intake",
    at: new Date(),
    accessMode: "ordinary",
    emergencyAccess: null,
  });
  return issueCareIntakeResumeGrant(
    {
      ...input,
      granteePrincipalId: input.actorPrincipalId,
      issuedByPrincipalId: input.actorPrincipalId,
      authorityDecision,
    },
    database,
  );
}

export async function getCareIntakePacketProjection(
  input: { packetId: string; token: string },
  database: CareIntakeApiDatabase = prisma as unknown as CareIntakeApiDatabase,
) {
  const claims = parseCareIntakeResumeToken(input.token);
  const digest = digestCareIntakeResumeToken(input.token);
  return database.$transaction(async (tx) => {
    await setPatientContext(tx, claims);
    const packet = await tx.careIntakePacket.findFirst({
      where: {
        packetId: input.packetId,
        organizationId: claims.organizationId,
        patientProfileId: claims.patientProfileId,
      },
    });
    if (!packet) throw new Error("Care intake access denied");
    const grant = await tx.careIntakeAccessGrant.findFirst({
      where: {
        grantId: claims.grantId,
        organizationId: claims.organizationId,
        patientProfileId: claims.patientProfileId,
      },
    });
    if (!grant) throw new Error("Care intake access denied");
    assertCareIntakeGrant(grant, {
      digest,
      grantId: claims.grantId,
      packetRowId: packet.id,
      patientProfileId: claims.patientProfileId,
      operation: "view",
      at: new Date(),
    });

    const requirements = packetRequirements(packet.requirementSnapshot);
    const formKeys = [
      ...new Map(
        requirements.map((requirement) => [
          `${requirement.dynamicFormId}:${requirement.dynamicFormVersion}`,
          {
            id: requirement.dynamicFormId,
            version: requirement.dynamicFormVersion,
          },
        ]),
      ).values(),
    ];
    const forms = await tx.dynamicForm.findMany({ where: { OR: formKeys } });
    if (forms.length !== formKeys.length) {
      throw new Error("Pinned intake form is unavailable");
    }
    await tx.careIntakeAccessGrant.updateMany({
      where: { grantId: claims.grantId, tokenDigest: digest },
      data: { lastUsedAt: new Date() },
    });

    return {
      packetId: packet.packetId,
      status: packet.status,
      version: packet.version,
      dueAt: packet.dueAt,
      completionPercent: packet.completionPercent,
      forms: forms.map((form) => {
        const assigned = requirementsForPinnedForm(requirements, {
          dynamicFormId: form.id,
          dynamicFormVersion: form.version,
        });
        const allowedKeys = new Set(assigned.map((item) => item.linkId));
        const fields = Array.isArray(form.fields)
          ? form.fields.filter(
              (field) =>
                field
                && typeof field === "object"
                && "key" in field
                && typeof field.key === "string"
                && allowedKeys.has(field.key),
            )
          : [];
        if (
          new Set(
            fields.flatMap((field) =>
              field && typeof field === "object" && "key" in field
                ? [field.key]
                : [],
            ),
          ).size !== allowedKeys.size
        ) {
          throw new Error("Pinned intake form does not match packet requirements");
        }
        return {
          formId: form.formId,
          title: form.title,
          version: form.version,
          fields,
          dataCategories: Object.fromEntries(
            assigned.map((item) => [item.linkId, item.dataCategory]),
          ),
          offlineCapable: form.offlineCapable,
        };
      }),
    };
  });
}

export async function getCareIntakeSavedResponse(
  input: { packetId: string; formId: string; token: string },
  database: CareIntakeApiDatabase = prisma as unknown as CareIntakeApiDatabase,
) {
  const claims = parseCareIntakeResumeToken(input.token);
  const digest = digestCareIntakeResumeToken(input.token);
  return database.$transaction(async (tx) => {
    await setPatientContext(tx, claims);
    const packet = await tx.careIntakePacket.findFirst({
      where: {
        packetId: input.packetId,
        organizationId: claims.organizationId,
        patientProfileId: claims.patientProfileId,
      },
    });
    if (!packet) throw new Error("Care intake access denied");
    const grant = await tx.careIntakeAccessGrant.findFirst({
      where: {
        grantId: claims.grantId,
        organizationId: claims.organizationId,
        patientProfileId: claims.patientProfileId,
      },
    });
    if (!grant) throw new Error("Care intake access denied");
    assertCareIntakeGrant(grant, {
      digest,
      grantId: claims.grantId,
      packetRowId: packet.id,
      patientProfileId: claims.patientProfileId,
      operation: "view",
      at: new Date(),
    });
    const form = await tx.dynamicForm.findFirst({ where: { formId: input.formId } });
    if (!form) throw new Error("Dynamic form is not assigned to this intake packet");
    const assigned = requirementsForPinnedForm(
      packetRequirements(packet.requirementSnapshot),
      { dynamicFormId: form.id, dynamicFormVersion: form.version },
    );
    if (assigned.length === 0) {
      throw new Error("Dynamic form is not assigned to this intake packet");
    }
    const response = await tx.careIntakeResponse.findFirst({
      where: {
        organizationId: claims.organizationId,
        packetId: packet.id,
        dynamicFormId: form.id,
        status: { not: "entered-in-error" },
      },
      orderBy: { version: "desc" },
    });
    await tx.careIntakeAccessGrant.updateMany({
      where: { grantId: claims.grantId, tokenDigest: digest },
      data: { lastUsedAt: new Date() },
    });
    if (!response) {
      return {
        responseId: null,
        version: null,
        status: "not-started" as const,
        answers: {},
        answeredLinkIds: [],
      };
    }
    return {
      responseId: response.responseId,
      version: response.version,
      status: response.status ?? "in-progress",
      answers:
        response.answers && typeof response.answers === "object" && !Array.isArray(response.answers)
          ? response.answers as Record<string, unknown>
          : {},
      answeredLinkIds: response.answeredLinkIds,
    };
  });
}

export async function saveCareIntakePartialResponse(
  input: {
    packetId: string;
    formId: string;
    token: string;
    idempotencyKey: string;
    expectedVersion: number | null;
    sourceMode: CareIntakeSourceMode;
    answers: Record<string, unknown>;
    dataCategories: Record<string, string>;
  },
  database: CareIntakeApiDatabase = prisma as unknown as CareIntakeApiDatabase,
) {
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(input.idempotencyKey)) {
    throw new Error("Invalid intake idempotency key");
  }
  const claims = parseCareIntakeResumeToken(input.token);
  const digest = digestCareIntakeResumeToken(input.token);
  return database.$transaction(async (tx) => {
    await setPatientContext(tx, claims);
    const packet = await tx.careIntakePacket.findFirst({
      where: {
        packetId: input.packetId,
        organizationId: claims.organizationId,
        patientProfileId: claims.patientProfileId,
      },
    });
    if (!packet || !["assigned", "in-progress", "amended"].includes(packet.status)) {
      throw new Error("Care intake access denied");
    }
    const grant = await tx.careIntakeAccessGrant.findFirst({
      where: {
        grantId: claims.grantId,
        organizationId: claims.organizationId,
        patientProfileId: claims.patientProfileId,
      },
    });
    if (!grant || !grant.granteePrincipalId) throw new Error("Care intake access denied");
    assertCareIntakeGrant(grant, {
      digest,
      grantId: claims.grantId,
      packetRowId: packet.id,
      patientProfileId: claims.patientProfileId,
      operation: "save",
      at: new Date(),
    });
    const form = await tx.dynamicForm.findFirst({ where: { formId: input.formId } });
    if (!form) throw new Error("Dynamic form is not assigned to this intake packet");
    const assigned = requirementsForPinnedForm(
      packetRequirements(packet.requirementSnapshot),
      { dynamicFormId: form.id, dynamicFormVersion: form.version },
    );
    const answerDescriptors = Object.keys(input.answers).map((linkId) => ({
      linkId,
      dataCategory: input.dataCategories[linkId] ?? "",
    }));
    const minimumNecessary = validateMinimumNecessaryAnswers({
      requirements: assigned,
      allowedDataCategories: packet.allowedDataCategories,
      answers: answerDescriptors,
    });
    if (!minimumNecessary.ok) throw new Error(minimumNecessary.errors.join(","));

    const existing = await tx.careIntakeResponse.findFirst({
      where: {
        organizationId: claims.organizationId,
        packetId: packet.id,
        dynamicFormId: form.id,
        status: { not: "entered-in-error" },
      },
      orderBy: { version: "desc" },
    });
    if (existing?.sourceVersion === input.idempotencyKey) {
      await markPacketInProgressAfterFirstSave(tx, packet, {
        sourceMode: input.sourceMode,
        actorPrincipalId: grant.granteePrincipalId,
      });
      await tx.careIntakeAccessGrant.updateMany({
        where: { grantId: claims.grantId, tokenDigest: digest },
        data: { lastUsedAt: new Date() },
      });
      return {
        responseId: existing.responseId,
        status: "in-progress" as const,
        version: existing.version,
        answeredLinkIds: existing.answeredLinkIds,
      };
    }
    const answeredLinkIds = Object.entries(input.answers)
      .filter(([, value]) => hasSubstantiveAnswer(value))
      .map(([linkId]) => linkId)
      .sort();
    const formSnapshot = { formId: form.formId, title: form.title, version: form.version, fields: form.fields };
    const formDigest = createHash("sha256")
      .update(JSON.stringify(formSnapshot))
      .digest("hex");

    if (existing) {
      if (input.expectedVersion !== existing.version) {
        throw new Error("stale-intake-response-version");
      }
      const version = existing.version + 1;
      const updated = await tx.careIntakeResponse.updateMany({
        where: { id: existing.id, version: existing.version },
        data: {
          version,
          answers: input.answers,
          answeredLinkIds,
          dataCategories: [...new Set(answerDescriptors.map((item) => item.dataCategory))],
          sourceMode: input.sourceMode,
          sourcePrincipalId: grant.granteePrincipalId,
          recordedByPrincipalId: grant.granteePrincipalId,
          sourceVersion: input.idempotencyKey,
          authoredAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new Error("stale-intake-response-version");
      await markPacketInProgressAfterFirstSave(tx, packet, {
        sourceMode: input.sourceMode,
        actorPrincipalId: grant.granteePrincipalId,
      });
      await tx.careIntakeAccessGrant.updateMany({
        where: { grantId: claims.grantId, tokenDigest: digest },
        data: { lastUsedAt: new Date() },
      });
      return { responseId: existing.responseId, status: "in-progress" as const, version, answeredLinkIds };
    }
    if (input.expectedVersion !== null) throw new Error("stale-intake-response-version");
    const response = await tx.careIntakeResponse.create({
      data: {
        responseId: `intake-response-${randomUUID()}`,
        organizationId: claims.organizationId,
        packetId: packet.id,
        patientProfileId: claims.patientProfileId,
        dynamicFormId: form.id,
        dynamicFormVersion: form.version,
        formSnapshot,
        formDigest,
        answers: input.answers,
        answeredLinkIds,
        dataCategories: [...new Set(answerDescriptors.map((item) => item.dataCategory))],
        sourceMode: input.sourceMode,
        sourcePrincipalId: grant.granteePrincipalId,
        recordedByPrincipalId: grant.granteePrincipalId,
        sourceSystem: "care-intake-api",
        sourceId: `${packet.id}:${form.id}`,
        sourceVersion: input.idempotencyKey,
      },
    });
    await markPacketInProgressAfterFirstSave(tx, packet, {
      sourceMode: input.sourceMode,
      actorPrincipalId: grant.granteePrincipalId,
    });
    await tx.careIntakeAccessGrant.updateMany({
      where: { grantId: claims.grantId, tokenDigest: digest },
      data: { lastUsedAt: new Date() },
    });
    return {
      responseId: response.responseId,
      status: "in-progress" as const,
      version: response.version,
      answeredLinkIds: response.answeredLinkIds,
    };
  });
}

export async function submitCareIntakePacket(
  input: {
    packetId: string;
    token: string;
    expectedVersion: number;
    sourceMode: CareIntakeSourceMode;
  },
  database: CareIntakeApiDatabase = prisma as unknown as CareIntakeApiDatabase,
) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new Error("Invalid intake packet version");
  }
  const claims = parseCareIntakeResumeToken(input.token);
  const digest = digestCareIntakeResumeToken(input.token);
  return database.$transaction(async (tx) => {
    await setPatientContext(tx, claims);
    const packet = await tx.careIntakePacket.findFirst({
      where: {
        packetId: input.packetId,
        organizationId: claims.organizationId,
        patientProfileId: claims.patientProfileId,
      },
    });
    if (!packet || packet.status !== "in-progress") {
      throw new Error("Care intake access denied");
    }
    const grant = await tx.careIntakeAccessGrant.findFirst({
      where: {
        grantId: claims.grantId,
        organizationId: claims.organizationId,
        patientProfileId: claims.patientProfileId,
      },
    });
    if (!grant || !grant.granteePrincipalId) throw new Error("Care intake access denied");
    assertCareIntakeGrant(grant, {
      digest,
      grantId: claims.grantId,
      packetRowId: packet.id,
      patientProfileId: claims.patientProfileId,
      operation: "submit",
      at: new Date(),
    });

    const [responses, unresolvedExceptionCount, acceptedConsentCount, acceptedCoverageEvidenceCount] =
      await Promise.all([
        tx.careIntakeResponse.findMany({
          where: {
            packetId: packet.id,
            organizationId: claims.organizationId,
            status: { not: "entered-in-error" },
          },
          select: { answeredLinkIds: true },
        }),
        tx.careIntakeException.count({
          where: {
            packetId: packet.id,
            organizationId: claims.organizationId,
            status: { in: ["open", "in-progress"] },
          },
        }),
        tx.careConsentAttestation.count({
          where: { packetId: packet.id, organizationId: claims.organizationId, status: "accepted" },
        }),
        tx.careCoverageEvidence.count({
          where: { packetId: packet.id, organizationId: claims.organizationId, status: "accepted" },
        }),
      ]);
    const readiness = calculateIntakeReadiness({
      requirements: packetRequirements(packet.requirementSnapshot),
      answeredLinkIds: [...new Set(responses.flatMap((row) => row.answeredLinkIds))],
      unresolvedExceptionCount,
      requiredConsentCount: packet.requiredConsentCount,
      acceptedConsentCount,
      requiredCoverageEvidence: packet.requiresCoverageEvidence,
      acceptedCoverageEvidenceCount,
    });
    await tx.careIntakeAccessGrant.updateMany({
      where: { grantId: claims.grantId, tokenDigest: digest },
      data: { lastUsedAt: new Date() },
    });
    if (!readiness.ready) {
      return {
        ok: false as const,
        blockers: readiness.blockers,
        missingRequiredLinkIds: readiness.missingRequiredLinkIds,
        completionPercent: readiness.completionPercent,
      };
    }

    const completedAt = new Date();
    const version = packet.version + 1;
    const updated = await tx.careIntakePacket.updateMany({
      where: {
        id: packet.id,
        organizationId: claims.organizationId,
        status: "in-progress",
        version: input.expectedVersion,
      },
      data: {
        status: "completed",
        version,
        completionPercent: readiness.completionPercent,
        completedAt,
      },
    });
    if (updated.count !== 1) throw new Error("stale-intake-packet-version");
    await tx.careIntakeResponse.updateMany({
      where: { packetId: packet.id, organizationId: claims.organizationId, status: "in-progress" },
      data: { status: "completed", completedAt },
    });
    await tx.careIntakeStatusEvent.create({
      data: {
        eventId: `intake-event-${randomUUID()}`,
        organizationId: claims.organizationId,
        packetId: packet.id,
        patientProfileId: claims.patientProfileId,
        packetVersion: version,
        fromStatus: "in-progress",
        toStatus: "completed",
        reason: "patient-submitted",
        sourceMode: input.sourceMode,
        actorPrincipalId: grant.granteePrincipalId,
      },
    });
    return {
      ok: true as const,
      packetId: packet.packetId,
      status: "completed" as const,
      version,
      completionPercent: readiness.completionPercent,
    };
  });
}
