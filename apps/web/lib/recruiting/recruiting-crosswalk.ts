// BI-E64D11AE (Absorb, Seam A generalized) — the recruiting external-source
// crosswalk. Maps an external ATS record (Greenhouse candidate/application/etc.)
// to a canonical DPF recruiting entity via MasterDataSourceRef's soft-ref
// (domain, sourceSystem, sourceEntityId) -> canonicalId, with no schema change.
// Connector-agnostic: Greenhouse now, Fountain/Workday later reuse it verbatim.

export const RECRUITING_DOMAINS = {
  candidate: "recruiting-candidate",
  application: "recruiting-application",
  job: "recruiting-job",
  offer: "recruiting-offer",
  scorecard: "recruiting-scorecard",
} as const;

export type RecruitingCrosswalkDomain =
  (typeof RECRUITING_DOMAINS)[keyof typeof RECRUITING_DOMAINS];

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type RecruitingCrosswalkClient = {
  masterDataSourceRef: {
    findUnique: (args: unknown) => Promise<{ canonicalId: string } | null>;
    findMany: (args: unknown) => Promise<Array<{ sourceEntityId: string; canonicalId: string }>>;
    upsert: (args: unknown) => Promise<unknown>;
  };
};

export interface RegisterCrosswalkInput {
  domain: RecruitingCrosswalkDomain;
  sourceSystem: string;
  sourceEntityId: string;
  canonicalId: string;
  trustTier?: string;
}

/**
 * Idempotently record (or refresh) the crosswalk for one external record. The
 * @@unique(domain, sourceSystem, sourceEntityId) makes re-registration a no-op
 * update; the canonicalId can be corrected but the key is stable.
 */
export async function registerRecruitingCrosswalk(
  db: RecruitingCrosswalkClient,
  input: RegisterCrosswalkInput,
): Promise<void> {
  const now = new Date();
  await db.masterDataSourceRef.upsert({
    where: {
      domain_sourceSystem_sourceEntityId: {
        domain: input.domain,
        sourceSystem: input.sourceSystem,
        sourceEntityId: input.sourceEntityId,
      },
    },
    create: {
      domain: input.domain,
      canonicalId: input.canonicalId,
      sourceSystem: input.sourceSystem,
      sourceEntityId: input.sourceEntityId,
      observedAt: now,
      lastSeenAt: now,
      trustTier: input.trustTier ?? "connector",
    },
    update: {
      canonicalId: input.canonicalId,
      lastSeenAt: now,
    },
  });
}

/** Resolve one external record to its canonical recruiting entity id, or null. */
export async function resolveNativeRecruitingId(
  db: RecruitingCrosswalkClient,
  args: { domain: RecruitingCrosswalkDomain; sourceSystem: string; sourceEntityId: string },
): Promise<string | null> {
  const ref = await db.masterDataSourceRef.findUnique({
    where: {
      domain_sourceSystem_sourceEntityId: {
        domain: args.domain,
        sourceSystem: args.sourceSystem,
        sourceEntityId: args.sourceEntityId,
      },
    },
  });
  return ref?.canonicalId ?? null;
}

/**
 * Bulk map of sourceEntityId -> canonicalId for a domain+source. Used by the
 * dual-read pipeline to dedupe already-crosswalked (promoted) external records
 * against native rows so the operator sees one funnel, not two.
 */
export async function loadRecruitingCrosswalk(
  db: RecruitingCrosswalkClient,
  args: { domain: RecruitingCrosswalkDomain; sourceSystem: string },
): Promise<Map<string, string>> {
  const refs = await db.masterDataSourceRef.findMany({
    where: { domain: args.domain, sourceSystem: args.sourceSystem, status: "active" },
    select: { sourceEntityId: true, canonicalId: true },
  });
  return new Map(refs.map((r) => [r.sourceEntityId, r.canonicalId]));
}
