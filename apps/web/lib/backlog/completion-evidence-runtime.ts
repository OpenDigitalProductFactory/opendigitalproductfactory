import { isRecord } from "@/lib/shared/coerce";

import {
  evaluateCompletionEvidence,
  normalizeCompletionEvidenceManifest,
  type ActiveBuildCompletionEvidence,
  type CompletionEvidenceFact,
  type CompletionEvidenceVerdict,
} from "./completion-evidence-policy";
import {
  evidenceKindMetadata,
  normalizeExecutionEvidencePayload,
  validateExecutionEvidenceStructure,
} from "./execution-evidence";

const EVIDENCE_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_ROWS = 250;

type BacklogItemRow = {
  id: string;
  itemId: string;
  status: string;
  workType: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  activeBuild: {
    verificationOut: unknown;
    uxVerificationStatus: string | null;
  } | null;
};

type BacklogItemActivityRow = {
  id: string;
  backlogItemId: string;
  kind: string;
  recordedAt: Date;
  payload: unknown;
};

export type CompletionEvidenceRuntimeDb = {
  backlogItem: {
    findUnique(args: unknown): Promise<BacklogItemRow | null>;
  };
  backlogItemActivity: {
    findMany(args: unknown): Promise<BacklogItemActivityRow[]>;
  };
};

export type ResolveCompletionEvidenceResult =
  | { kind: "not-found"; itemId: string }
  | {
      kind: "evaluated";
      item: Pick<BacklogItemRow, "id" | "itemId" | "status" | "workType">;
      verdict: CompletionEvidenceVerdict;
    };

function laterDate(a: Date, b: Date): Date {
  return a >= b ? a : b;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function projectActiveBuildCompletionEvidence(
  row: BacklogItemRow["activeBuild"],
): ActiveBuildCompletionEvidence | null {
  if (!row) return null;
  const verification = isRecord(row.verificationOut) ? row.verificationOut : {};
  const ux: ActiveBuildCompletionEvidence["ux"] =
    row.uxVerificationStatus === "complete"
      ? "verified"
      : row.uxVerificationStatus === "skipped"
        ? "skipped"
        : row.uxVerificationStatus === "failed"
          ? "failed"
          : "not-run";
  return {
    testsPassed:
      verification.typecheckPassed === true
      && numberValue(verification.testsFailed) === 0,
    productionBuildPassed: verification.buildPassed === true,
    ux,
  };
}

function projectEvidenceFact(row: BacklogItemActivityRow): CompletionEvidenceFact | null {
  if (row.kind !== "evidence") return null;
  const payload = normalizeExecutionEvidencePayload(row.payload);
  if (!payload) return null;
  return {
    id: row.id,
    itemId: row.backlogItemId,
    evidenceKind: payload.evidenceKind,
    recordedAt: row.recordedAt,
    structurallyValid:
      evidenceKindMetadata(payload.evidenceKind).polarity !== "pass"
      || validateExecutionEvidenceStructure(payload.evidenceKind, payload.url) == null,
  };
}

export async function resolveCompletionEvidence(
  db: CompletionEvidenceRuntimeDb,
  input: {
    itemId: string;
    rawManifest: unknown;
    now?: Date;
  },
): Promise<ResolveCompletionEvidenceResult> {
  const item = await db.backlogItem.findUnique({
    where: { itemId: input.itemId },
    select: {
      id: true,
      itemId: true,
      status: true,
      workType: true,
      claimedAt: true,
      createdAt: true,
      activeBuild: {
        select: {
          verificationOut: true,
          uxVerificationStatus: true,
        },
      },
    },
  });
  if (!item) return { kind: "not-found", itemId: input.itemId };

  const now = input.now ?? new Date();
  const freshnessCutoff = new Date(now.getTime() - EVIDENCE_FRESHNESS_MS);
  const evidenceCutoff = laterDate(item.claimedAt ?? item.createdAt, freshnessCutoff);
  if (item.status === "done") {
    return {
      kind: "evaluated",
      item: {
        id: item.id,
        itemId: item.itemId,
        status: item.status,
        workType: item.workType,
      },
      verdict: evaluateCompletionEvidence({
        item: {
          id: item.id,
          itemId: item.itemId,
          status: item.status,
          workType: item.workType,
        },
        rawManifest: input.rawManifest,
        evidence: [],
        activeBuildEvidence: null,
        evidenceCutoff,
        now,
      }),
    };
  }
  const manifest = normalizeCompletionEvidenceManifest(input.rawManifest);
  const referencedIds = manifest?.evidenceActivityIds ?? [];
  const activities = await db.backlogItemActivity.findMany({
    where: {
      OR: [
        ...(referencedIds.length > 0 ? [{ id: { in: referencedIds } }] : []),
        {
          backlogItemId: item.id,
          kind: "evidence",
          recordedAt: { gte: evidenceCutoff },
        },
      ],
    },
    select: {
      id: true,
      backlogItemId: true,
      kind: true,
      recordedAt: true,
      payload: true,
    },
    orderBy: { recordedAt: "desc" },
    take: MAX_ACTIVITY_ROWS,
  });
  const evidence = activities
    .map(projectEvidenceFact)
    .filter((entry): entry is CompletionEvidenceFact => entry != null);
  const verdict = evaluateCompletionEvidence({
    item: {
      id: item.id,
      itemId: item.itemId,
      status: item.status,
      workType: item.workType,
    },
    rawManifest: input.rawManifest,
    evidence,
    activeBuildEvidence: manifest?.useActiveBuildEvidence
      ? projectActiveBuildCompletionEvidence(item.activeBuild)
      : null,
    evidenceCutoff,
    now,
  });
  return {
    kind: "evaluated",
    item: {
      id: item.id,
      itemId: item.itemId,
      status: item.status,
      workType: item.workType,
    },
    verdict,
  };
}
