// BI-E64D11AE (Absorb) — the "one funnel" read model. Unions native recruiting
// Applications with Greenhouse-staged application records (dual-read), deduping
// staged records that have already been crosswalked to a native row. This lets
// the operator see one pipeline across native + Greenhouse-sourced work without
// a lossy promotion step (design §4 Phase 2).

const GREENHOUSE = "greenhouse";
const RECRUITING_APPLICATION_DOMAIN = "recruiting-application";

export interface PipelineItem {
  /** Native application id, or `greenhouse:<externalId>` for a staged row. */
  id: string;
  source: "native" | "greenhouse";
  displayName: string;
  status: string | null;
  stage: string | null;
  externalId: string | null;
}

export interface RecruitingPipeline {
  items: PipelineItem[];
  counts: { native: number; greenhouse: number; total: number };
}

type StagedDisplayField = { label?: string; value?: string };

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type RecruitingPipelineClient = {
  application: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        status: string | null;
        candidate: { displayName: string } | null;
        currentStage: { name: string } | null;
      }>
    >;
  };
  integrationImportStagedRecord: {
    findMany: (args: unknown) => Promise<
      Array<{ externalId: string; displayFields: unknown }>
    >;
  };
  masterDataSourceRef: {
    findMany: (args: unknown) => Promise<Array<{ sourceEntityId: string }>>;
  };
};

function fieldValue(displayFields: unknown, label: string): string | null {
  if (!Array.isArray(displayFields)) return null;
  const match = (displayFields as StagedDisplayField[]).find(
    (f) => f && typeof f.label === "string" && f.label.toLowerCase() === label.toLowerCase(),
  );
  return match?.value ?? null;
}

export interface GetRecruitingPipelineArgs {
  requisitionId?: string;
}

/**
 * Read the unified recruiting pipeline. Native applications first, then any
 * Greenhouse-staged applications not yet promoted to a native row.
 */
export async function getRecruitingPipeline(
  db: RecruitingPipelineClient,
  args: GetRecruitingPipelineArgs = {},
): Promise<RecruitingPipeline> {
  const nativeApps = await db.application.findMany({
    where: args.requisitionId ? { requisitionId: args.requisitionId } : {},
    select: {
      id: true,
      status: true,
      candidate: { select: { displayName: true } },
      currentStage: { select: { name: true } },
    },
  });

  const nativeItems: PipelineItem[] = nativeApps.map((a) => ({
    id: a.id,
    source: "native",
    displayName: a.candidate?.displayName ?? "(unknown candidate)",
    status: a.status,
    stage: a.currentStage?.name ?? null,
    externalId: null,
  }));

  // Dedupe: staged rows already crosswalked to a native row are represented by
  // the native item above, so drop them from the Greenhouse side.
  const promotedRefs = await db.masterDataSourceRef.findMany({
    where: { domain: RECRUITING_APPLICATION_DOMAIN, sourceSystem: GREENHOUSE, status: "active" },
    select: { sourceEntityId: true },
  });
  const promoted = new Set(promotedRefs.map((r) => r.sourceEntityId));

  const staged = await db.integrationImportStagedRecord.findMany({
    where: {
      sourceProvider: GREENHOUSE,
      entityFamily: RECRUITING_APPLICATION_DOMAIN,
      reviewStatus: { in: ["candidate", "linked"] },
    },
    select: { externalId: true, displayFields: true },
  });

  const greenhouseItems: PipelineItem[] = staged
    .filter((r) => !promoted.has(r.externalId))
    .map((r) => ({
      id: `greenhouse:${r.externalId}`,
      source: "greenhouse",
      displayName: fieldValue(r.displayFields, "Name") ?? `Greenhouse application ${r.externalId}`,
      status: fieldValue(r.displayFields, "Status"),
      stage: fieldValue(r.displayFields, "Stage"),
      externalId: r.externalId,
    }));

  const items = [...nativeItems, ...greenhouseItems];
  return {
    items,
    counts: {
      native: nativeItems.length,
      greenhouse: greenhouseItems.length,
      total: items.length,
    },
  };
}
