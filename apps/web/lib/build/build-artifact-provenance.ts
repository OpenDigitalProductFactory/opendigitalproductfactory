import { Prisma, prisma } from "@dpf/db";
import { createHash } from "crypto";
import {
  evaluateArtifactContract,
  PROVENANCE_GATED_FIELDS,
  type ProvenanceGatedField,
  type ProvenanceReceiptSummary,
} from "./build-provenance-contracts";

export const BUILD_ARTIFACT_FIELDS = [
  "designDoc",
  "designReview",
  "buildPlan",
  "planReview",
  "taskResults",
  "verificationOut",
  "acceptanceMet",
  "scoutFindings",
  "uxTestResults",
] as const;

export type BuildArtifactField = (typeof BUILD_ARTIFACT_FIELDS)[number];

type ProvenanceDbClient = {
  artifactReceiptUsage: {
    createMany: typeof prisma.artifactReceiptUsage.createMany;
  };
  buildArtifactRevision: {
    create: typeof prisma.buildArtifactRevision.create;
    findFirst: typeof prisma.buildArtifactRevision.findFirst;
  };
  featureBuild: {
    update: typeof prisma.featureBuild.update;
  };
  toolExecutionReceipt: {
    findMany: typeof prisma.toolExecutionReceipt.findMany;
  };
};

const RECEIPT_KINDS_BY_FIELD: Partial<Record<BuildArtifactField, string[]>> = {
  verificationOut: ["sandbox-test-run", "sandbox-command"],
  uxTestResults: ["ux-run", "ux-evaluation"],
};

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }

  return value;
}

function digestValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeJson(value)))
    .digest("hex");
}

async function loadAcceptedArtifact(
  db: ProvenanceDbClient,
  buildId: string,
  field: ProvenanceGatedField,
): Promise<unknown> {
  const revision = await db.buildArtifactRevision.findFirst({
    where: {
      buildId,
      field,
      status: "accepted",
    },
    orderBy: {
      revisionNumber: "desc",
    },
    select: {
      value: true,
    },
  });

  return revision?.value ?? null;
}

async function loadReceiptSummaries(
  db: ProvenanceDbClient,
  buildId: string,
  field: BuildArtifactField,
  receiptIds: string[],
): Promise<ProvenanceReceiptSummary[]> {
  const receiptKinds = RECEIPT_KINDS_BY_FIELD[field];
  if (!receiptKinds && receiptIds.length === 0) {
    return [];
  }

  const receipts = await db.toolExecutionReceipt.findMany({
    where: receiptIds.length > 0
      ? {
          id: { in: receiptIds },
        }
      : {
          buildId,
          receiptKind: { in: receiptKinds },
          receiptStatus: "valid",
        },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      buildId: true,
      executionStatus: true,
      receiptKind: true,
    },
    take: receiptIds.length > 0 ? receiptIds.length : 10,
  });

  return receipts.map((receipt) => ({
    id: receipt.id,
    buildId: receipt.buildId,
    executionStatus: receipt.executionStatus,
    receiptKind: receipt.receiptKind,
  }));
}

type PersistArtifactRevisionArgs = {
  buildId: string;
  enforcementMode?: "shadow" | "enforce";
  field: BuildArtifactField;
  legacyEvidence?: boolean;
  receiptIds?: string[];
  savedByAgentId?: string | null;
  savedByUserId: string;
  threadId?: string | null;
  value: unknown;
};

export type PersistArtifactRevisionResult = {
  errors: string[];
  receiptIds: string[];
  revisionId: string;
  revisionNumber: number;
  status: string;
  warnings: string[];
};

async function persistWithDb(
  db: ProvenanceDbClient,
  args: PersistArtifactRevisionArgs,
): Promise<PersistArtifactRevisionResult> {
  if (args.value === undefined) {
    throw new Error(`Cannot save ${args.field} with an undefined value`);
  }

  const acceptedArtifacts = Object.fromEntries(
    await Promise.all(
      PROVENANCE_GATED_FIELDS.filter((field) => field !== "acceptanceMet").map(
        async (field) => [field, await loadAcceptedArtifact(db, args.buildId, field)] as const,
      ),
    ),
  ) as Partial<Record<ProvenanceGatedField, unknown>>;

  const resolvedReceiptIds = args.receiptIds?.filter((id) => typeof id === "string" && id.trim().length > 0) ?? [];
  const receiptSummaries = await loadReceiptSummaries(
    db,
    args.buildId,
    args.field,
    resolvedReceiptIds,
  );

  const evaluation = evaluateArtifactContract({
    acceptedArtifacts,
    enforcementMode: args.enforcementMode ?? "shadow",
    field: args.field,
    receiptSummaries,
    value: args.value,
  });

  if (!evaluation.ok) {
    throw new Error(evaluation.errors.join("; "));
  }

  const latestRevision = await db.buildArtifactRevision.findFirst({
    where: {
      buildId: args.buildId,
      field: args.field,
    },
    orderBy: {
      revisionNumber: "desc",
    },
    select: {
      revisionNumber: true,
    },
  });

  const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
  const status =
    evaluation.errors.length > 0
      ? "warning"
      : "accepted";

  const revision = await db.buildArtifactRevision.create({
    data: {
      buildId: args.buildId,
      field: args.field,
      legacyEvidence: args.legacyEvidence ?? false,
      revisionNumber,
      savedByAgentId: args.savedByAgentId ?? null,
      savedByUserId: args.savedByUserId,
      status,
      threadId: args.threadId ?? null,
      value: args.value as Prisma.InputJsonValue,
      valueDigest: digestValue(args.value),
    },
    select: {
      id: true,
      revisionNumber: true,
      status: true,
    },
  });

  if (receiptSummaries.length > 0) {
    await db.artifactReceiptUsage.createMany({
      data: receiptSummaries.map((receipt) => ({
        artifactRevisionId: revision.id,
        receiptId: receipt.id,
      })),
      skipDuplicates: true,
    });
  }

  await db.featureBuild.update({
    where: { buildId: args.buildId },
    data: {
      [args.field]: args.value as Prisma.InputJsonValue,
    },
  });

  return {
    errors: evaluation.errors,
    receiptIds: receiptSummaries.map((receipt) => receipt.id),
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    status: revision.status,
    warnings: evaluation.warnings,
  };
}

export async function saveBuildArtifactRevision(
  args: PersistArtifactRevisionArgs,
): Promise<PersistArtifactRevisionResult> {
  return prisma.$transaction((tx) =>
    persistWithDb(tx as unknown as ProvenanceDbClient, args),
  );
}

export async function saveBuildArtifactRevisionWithDb(
  db: ProvenanceDbClient,
  args: PersistArtifactRevisionArgs,
): Promise<PersistArtifactRevisionResult> {
  return persistWithDb(db, args);
}
