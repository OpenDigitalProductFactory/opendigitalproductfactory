import type { ActivityRow, PortalContextDb } from "./db-types";
import type { EvidenceSummary, PortalContextEnvelope } from "./types";

type WorkProjection = PortalContextEnvelope["work"];

export async function resolvePortalEvidence(work: WorkProjection, db: PortalContextDb): Promise<EvidenceSummary[]> {
  const evidence: EvidenceSummary[] = [];

  if (work.featureBuild) {
    evidence.push({
      kind: work.featureBuild.evidenceComplete ? "build_evidence_present" : "build_evidence_gap",
      source: "build_evidence",
      recordId: work.featureBuild.buildId,
      label: work.featureBuild.evidenceComplete ? "Build evidence present" : "Build evidence pending",
      recordedAt: new Date().toISOString(),
      isGap: !work.featureBuild.evidenceComplete,
    });
  }

  const capsuleId = work.capsule?.capsuleId;
  if (capsuleId) {
    const rows = await safelyReadActivities(() =>
      db.workroomActivity.findMany({
        where: { capsule: { capsuleId } },
        orderBy: { recordedAt: "desc" },
        take: 5,
      }),
    );
    for (const row of rows) {
      evidence.push(activityEvidence(row, "capsule_activity"));
    }
  }

  const backlogItemId = work.backlogItem?.backlogItemId;
  if (backlogItemId) {
    const rows = await safelyReadActivities(() =>
      db.backlogItemActivity.findMany({
        where: { backlogItem: { itemId: backlogItemId } },
        orderBy: { recordedAt: "desc" },
        take: 5,
      }),
    );
    for (const row of rows) {
      evidence.push(activityEvidence(row, "backlog_activity"));
    }
  }

  return dedupeEvidence(evidence);
}

async function safelyReadActivities(read: () => Promise<ActivityRow[]>): Promise<ActivityRow[]> {
  try {
    return await read();
  } catch {
    return [];
  }
}

function activityEvidence(row: ActivityRow, source: EvidenceSummary["source"]): EvidenceSummary {
  return {
    kind: row.kind,
    source,
    recordId: row.id,
    label: row.summary,
    recordedAt: new Date(row.recordedAt).toISOString(),
    isGap: row.kind.includes("gap") || row.kind.includes("missing"),
  };
}

function dedupeEvidence(evidence: EvidenceSummary[]): EvidenceSummary[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.source}:${item.recordId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
