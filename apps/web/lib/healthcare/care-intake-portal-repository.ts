import { prisma } from "@dpf/db";

import { authorizeAndIssueCareIntakeResumeGrant } from "./care-intake-api-repository";

type PatientPortalProfile = {
  id: string;
  patientId: string;
  organizationId: string;
  principalId: string;
};

type PatientPortalPacket = {
  packetId: string;
  status: string;
  dueAt: Date | null;
  completionPercent: number;
  appointmentId: string | null;
  sourceMode: string;
  updatedAt: Date;
};

type PatientPortalTransaction = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  patientProfile: {
    findFirst(args: unknown): Promise<PatientPortalProfile | null>;
  };
  careIntakePacket: {
    findMany(args: unknown): Promise<PatientPortalPacket[]>;
  };
};

export type PatientPortalDatabase = {
  $transaction<T>(
    callback: (transaction: PatientPortalTransaction) => Promise<T>,
  ): Promise<T>;
};

export type PatientCareTask = {
  packetId: string;
  status: string;
  dueAt: string | null;
  completionPercent: number;
  hasAppointment: boolean;
  sourceMode: string;
  updatedAt: string;
};

export type PatientCareTaskList = {
  linked: boolean;
  tasks: PatientCareTask[];
};

type PortalIdentity = {
  organizationId: string;
  actorPrincipalId: string;
};

async function setPatientPortalContext(
  transaction: PatientPortalTransaction,
  identity: PortalIdentity,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT
      set_config('app.organization_id', ${identity.organizationId}, true),
      set_config('app.patient_principal_ids', ${identity.actorPrincipalId}, true)
  `;
}

async function findPatientPortalProfile(
  transaction: PatientPortalTransaction,
  identity: PortalIdentity,
): Promise<PatientPortalProfile | null> {
  return transaction.patientProfile.findFirst({
    where: {
      organizationId: identity.organizationId,
      principalId: identity.actorPrincipalId,
      status: "active",
      mergedIntoPatientProfileId: null,
      enteredInErrorAt: null,
    },
    select: {
      id: true,
      patientId: true,
      organizationId: true,
      principalId: true,
    },
  });
}

async function resolvePatientPortalProfile(
  identity: PortalIdentity,
  database: PatientPortalDatabase,
): Promise<PatientPortalProfile | null> {
  return database.$transaction(async (transaction) => {
    await setPatientPortalContext(transaction, identity);
    return findPatientPortalProfile(transaction, identity);
  });
}

export async function listPatientCareTasks(
  identity: PortalIdentity,
  database: PatientPortalDatabase = prisma as unknown as PatientPortalDatabase,
): Promise<PatientCareTaskList> {
  return database.$transaction(async (transaction) => {
    await setPatientPortalContext(transaction, identity);
    const patient = await findPatientPortalProfile(transaction, identity);
    if (!patient) return { linked: false, tasks: [] };

    const packets = await transaction.careIntakePacket.findMany({
      where: {
        organizationId: identity.organizationId,
        patientProfileId: patient.id,
        status: { in: ["assigned", "in-progress", "amended"] },
      },
      select: {
        packetId: true,
        status: true,
        dueAt: true,
        completionPercent: true,
        appointmentId: true,
        sourceMode: true,
        updatedAt: true,
      },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
    });

    return {
      linked: true,
      tasks: packets.map((packet) => ({
        packetId: packet.packetId,
        status: packet.status,
        dueAt: packet.dueAt?.toISOString() ?? null,
        completionPercent: packet.completionPercent,
        hasAppointment: packet.appointmentId !== null,
        sourceMode: packet.sourceMode,
        updatedAt: packet.updatedAt.toISOString(),
      })),
    };
  });
}

type IssueGrantResult = {
  grantId: string;
  token: string;
  expiresAt: Date;
};

type IssueGrant = (
  input: Parameters<typeof authorizeAndIssueCareIntakeResumeGrant>[0],
) => Promise<IssueGrantResult>;

export async function issuePatientCareIntakeGrant(
  input: PortalIdentity & { packetId: string; now?: Date },
  dependencies: {
    database?: PatientPortalDatabase;
    issueGrant?: IssueGrant;
  } = {},
): Promise<{ grantId: string; token: string; expiresAt: string }> {
  const database = dependencies.database
    ?? (prisma as unknown as PatientPortalDatabase);
  const patient = await resolvePatientPortalProfile(input, database);
  if (!patient) throw new Error("Patient portal identity is not linked");

  const now = input.now ?? new Date();
  const result = await (dependencies.issueGrant
    ?? authorizeAndIssueCareIntakeResumeGrant)({
    organizationId: input.organizationId,
    packetId: input.packetId,
    patientProfileId: patient.id,
    patientPrincipalId: patient.principalId,
    actorPrincipalId: input.actorPrincipalId,
    permittedOperations: ["view", "save", "submit"],
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  });

  return {
    grantId: result.grantId,
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
  };
}
