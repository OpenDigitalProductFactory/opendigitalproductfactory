import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";
import {
  requirementsForPinnedForm,
  type CareIntakeRequirement,
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
};

type GrantRow = {
  grantId: string;
  packetId: string;
  patientProfileId: string;
  tokenDigest: string;
  permittedOperations: string[];
  expiresAt: Date;
  revokedAt: Date | null;
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
  careIntakePacket: { findFirst(args: unknown): Promise<PacketRow | null> };
  careIntakeAccessGrant: {
    create(args: unknown): Promise<GrantRow>;
    findFirst(args: unknown): Promise<GrantRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  dynamicForm: { findMany(args: unknown): Promise<DynamicFormRow[]> };
};

export type CareIntakeApiDatabase = {
  $transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
};

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
          offlineCapable: form.offlineCapable,
        };
      }),
    };
  });
}
