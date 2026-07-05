/**
 * MDM merge orchestrator + domain adapters (EP-4A12A7CB WG-4, spec §5.4).
 *
 * Kernel-ratified shape: ONE orchestrator owns the merge invariants —
 * validation, pre-merge snapshot, hard-FK and soft-reference repointing,
 * unique-collision planning, crosswalk repoint, tombstone — and each domain
 * declares its repoint lists explicitly. Soft references (columns with no FK
 * relation, e.g. ServiceTicket-style estate pointers on the security models)
 * cannot be derived from the schema at runtime, so the adapter is their
 * single home; the completeness test (merge-adapters-completeness.test.ts)
 * diffs the declared hard list against schema relations so a newly added FK
 * cannot be silently missed.
 *
 * A merge is link + supersede, never a hard-delete (kernel 2026-06-06): the
 * loser row keeps every attribute and is tombstoned with status="superseded"
 * + mergedIntoId, excluded from default reads. The returned MergeResult is
 * the audit payload — persisted automatically in ToolExecution.result on the
 * coworker path and logged as a system activity on the admin path.
 */
import { prisma } from "@dpf/db";
import { CUSTOMER_TOMBSTONE_STATUSES } from "@dpf/db/customer-lifecycle";

export type MergeableDomain = "customer-account" | "customer-site";

/** One repoint: set `model.field` from loserId → survivorId via updateMany. */
export type RepointStep = {
  /** Prisma client delegate key, e.g. "customerContact". */
  model: string;
  field: string;
  /**
   * Extra columns to set alongside the repoint (e.g. MasterDataSourceRef must
   * keep canonicalId equal to its typed FK per its CHECK constraint).
   */
  alsoSet?: (survivorId: string) => Record<string, string>;
};

export type MergeAdapter = {
  domain: MergeableDomain;
  /** Prisma delegate key of the canonical model. */
  model: string;
  /** FK-backed relations pointing at the canonical model. */
  hardRelations: RepointStep[];
  /** Columns pointing at the canonical model WITHOUT an FK relation. */
  softReferences: RepointStep[];
};

const CUSTOMER_ACCOUNT_ADAPTER: MergeAdapter = {
  domain: "customer-account",
  model: "customerAccount",
  hardRelations: [
    { model: "customerContact", field: "accountId" },
    { model: "accountInvite", field: "accountId" },
    { model: "customerAccount", field: "parentAccountId" },
    // customerSite.accountId is handled by the site collision plan first,
    // then this step repoints the remainder.
    { model: "customerSite", field: "accountId" },
    { model: "serviceTicket", field: "customerAccountId" },
    { model: "customerConfigurationItem", field: "accountId" },
    { model: "contactAccountRole", field: "accountId" },
    { model: "engagement", field: "accountId" },
    { model: "opportunity", field: "accountId" },
    { model: "quote", field: "accountId" },
    { model: "salesOrder", field: "accountId" },
    { model: "activity", field: "accountId" },
    { model: "discoveryRun", field: "customerAccountId" },
    { model: "inventoryEntity", field: "customerAccountId" },
    { model: "inventoryRelationship", field: "customerAccountId" },
    { model: "portfolioQualityIssue", field: "customerAccountId" },
    { model: "invoice", field: "accountId" },
    {
      model: "masterDataSourceRef",
      field: "customerAccountId",
      // CHECK constraint: typed FK must equal canonicalId for this domain.
      alsoSet: (survivorId) => ({ canonicalId: survivorId }),
    },
    { model: "recurringSchedule", field: "accountId" },
    { model: "discoveryConnection", field: "customerAccountId" },
    { model: "edgeNode", field: "customerAccountId" },
    { model: "bootstrapToken", field: "targetCustomerAccountId" },
    { model: "memberEquityEntry", field: "memberAccountId" },
  ],
  softReferences: [
    { model: "remoteAction", field: "customerAccountId" },
    { model: "securityEvent", field: "customerAccountId" },
    { model: "detection", field: "customerAccountId" },
    { model: "securityCase", field: "customerAccountId" },
    { model: "journalLine", field: "customerAccountId" },
  ],
};

const CUSTOMER_SITE_ADAPTER: MergeAdapter = {
  domain: "customer-site",
  model: "customerSite",
  hardRelations: [
    { model: "serviceTicket", field: "customerSiteId" },
    { model: "customerConfigurationItem", field: "siteId" },
    { model: "customerSiteNode", field: "siteId" },
    { model: "discoveryRun", field: "customerSiteId" },
    { model: "inventoryEntity", field: "customerSiteId" },
    { model: "inventoryRelationship", field: "customerSiteId" },
    { model: "portfolioQualityIssue", field: "customerSiteId" },
    { model: "discoveryConnection", field: "customerSiteId" },
    { model: "edgeNode", field: "customerSiteId" },
    { model: "bootstrapToken", field: "targetCustomerSiteId" },
  ],
  softReferences: [
    { model: "remoteAction", field: "customerSiteId" },
    { model: "securityEvent", field: "customerSiteId" },
    { model: "detection", field: "customerSiteId" },
    { model: "securityCase", field: "customerSiteId" },
  ],
};

export const MERGE_ADAPTERS: Readonly<Record<MergeableDomain, MergeAdapter>> = {
  "customer-account": CUSTOMER_ACCOUNT_ADAPTER,
  "customer-site": CUSTOMER_SITE_ADAPTER,
};

export type MergeResult = {
  domain: MergeableDomain;
  loserId: string;
  survivorId: string;
  /** Rows repointed per model.field step. */
  repointed: Record<string, number>;
  /** Loser sites merged into same-named survivor sites (account merges). */
  nestedSiteMerges: Array<{ loserSiteId: string; survivorSiteId: string }>;
  /** Pre-merge snapshot of the loser row (tombstone keeps it too). */
  loserSnapshot: Record<string, unknown>;
};

export type MergeError =
  | "not-found"
  | "same-record"
  | "already-superseded"
  | "would-cycle";

export class MergeValidationFailure extends Error {
  constructor(public readonly reason: MergeError) {
    super(`merge validation failed: ${reason}`);
  }
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Delegate = {
  updateMany: (args: unknown) => Promise<{ count: number }>;
  findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  update: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  deleteMany: (args: unknown) => Promise<{ count: number }>;
};

function delegate(tx: Tx, model: string): Delegate {
  return (tx as unknown as Record<string, Delegate>)[model]!;
}

const TOMBSTONE = CUSTOMER_TOMBSTONE_STATUSES[0];

/**
 * Merge `loserId` into `survivorId` for a mergeable domain, transactionally.
 * Throws MergeValidationFailure on an invalid pair; otherwise returns the
 * audit MergeResult. Never deletes the loser row.
 */
export async function mergeRecords(
  domain: MergeableDomain,
  loserId: string,
  survivorId: string,
): Promise<MergeResult> {
  const adapter = MERGE_ADAPTERS[domain];
  if (loserId === survivorId) throw new MergeValidationFailure("same-record");

  return prisma.$transaction(async (tx) => {
    const canonical = delegate(tx, adapter.model);
    const [loser, survivor] = await Promise.all([
      canonical.findUnique({ where: { id: loserId } }),
      canonical.findUnique({ where: { id: survivorId } }),
    ]);
    if (!loser || !survivor) throw new MergeValidationFailure("not-found");
    if (loser["status"] === TOMBSTONE || survivor["status"] === TOMBSTONE) {
      throw new MergeValidationFailure("already-superseded");
    }

    const repointed: Record<string, number> = {};
    const nestedSiteMerges: MergeResult["nestedSiteMerges"] = [];

    if (domain === "customer-account") {
      // Survivor must not end up its own ancestor via the loser.
      if (survivor["parentAccountId"] === loserId) {
        await canonical.update({
          where: { id: survivorId },
          data: { parentAccountId: (loser["parentAccountId"] as string | null) ?? null },
        });
      }

      // Collision plan 1 — sites: a loser site whose active normalized name
      // already exists on the survivor cannot simply repoint (partial unique
      // CustomerSite_accountId_nameNormalized_active); merge it into the
      // colliding survivor site instead (reference-data-merge precedent).
      const siteDelegate = delegate(tx, "customerSite");
      const [loserSites, survivorSites] = await Promise.all([
        siteDelegate.findMany({
          where: { accountId: loserId, status: { not: TOMBSTONE } },
          select: { id: true, nameNormalized: true },
        }),
        siteDelegate.findMany({
          where: { accountId: survivorId, status: { not: TOMBSTONE } },
          select: { id: true, nameNormalized: true },
        }),
      ]);
      const survivorByName = new Map<string, string>();
      for (const site of survivorSites) {
        const key = site["nameNormalized"] as string;
        if (key && !survivorByName.has(key)) survivorByName.set(key, site["id"] as string);
      }
      for (const site of loserSites) {
        const collision = survivorByName.get(site["nameNormalized"] as string);
        if (collision) {
          await mergeSiteWithinTx(tx, site["id"] as string, collision, repointed);
          nestedSiteMerges.push({
            loserSiteId: site["id"] as string,
            survivorSiteId: collision,
          });
        }
      }

      // Collision plan 2 — contact roles: (contactId, accountId, startedAt)
      // is unique; a loser role whose (contactId, startedAt) exists on the
      // survivor is the same fact twice — drop the loser copy.
      const roleDelegate = delegate(tx, "contactAccountRole");
      const [loserRoles, survivorRoles] = await Promise.all([
        roleDelegate.findMany({
          where: { accountId: loserId },
          select: { id: true, contactId: true, startedAt: true },
        }),
        roleDelegate.findMany({
          where: { accountId: survivorId },
          select: { contactId: true, startedAt: true },
        }),
      ]);
      const survivorRoleKeys = new Set(
        survivorRoles.map((r) => `${r["contactId"]}|${(r["startedAt"] as Date).toISOString()}`),
      );
      const collidingRoleIds = loserRoles
        .filter((r) =>
          survivorRoleKeys.has(`${r["contactId"]}|${(r["startedAt"] as Date).toISOString()}`),
        )
        .map((r) => r["id"] as string);
      if (collidingRoleIds.length > 0) {
        const dropped = await roleDelegate.deleteMany({
          where: { id: { in: collidingRoleIds } },
        });
        repointed["contactAccountRole.dropped-duplicates"] = dropped.count;
      }
    }

    // Repoint every declared hard relation and soft reference.
    for (const step of [...adapter.hardRelations, ...adapter.softReferences]) {
      // Skip the self-referencing tombstone pointer on the canonical model
      // itself for the loser row (set below), but DO repoint other rows.
      const where: Record<string, unknown> = { [step.field]: loserId };
      if (step.model === adapter.model) where["id"] = { not: loserId };
      const result = await delegate(tx, step.model).updateMany({
        where,
        data: { [step.field]: survivorId, ...(step.alsoSet?.(survivorId) ?? {}) },
      });
      if (result.count > 0) {
        repointed[`${step.model}.${step.field}`] =
          (repointed[`${step.model}.${step.field}`] ?? 0) + result.count;
      }
    }

    // Tombstone the loser: link + supersede, never delete.
    await canonical.update({
      where: { id: loserId },
      data: { status: TOMBSTONE, mergedIntoId: survivorId },
    });

    return {
      domain,
      loserId,
      survivorId,
      repointed,
      nestedSiteMerges,
      loserSnapshot: loser,
    };
  });
}

/** Merge one site into another inside an outer account-merge transaction. */
async function mergeSiteWithinTx(
  tx: Tx,
  loserSiteId: string,
  survivorSiteId: string,
  repointed: Record<string, number>,
): Promise<void> {
  const adapter = CUSTOMER_SITE_ADAPTER;
  for (const step of [...adapter.hardRelations, ...adapter.softReferences]) {
    const result = await delegate(tx, step.model).updateMany({
      where: { [step.field]: loserSiteId },
      data: { [step.field]: survivorSiteId, ...(step.alsoSet?.(survivorSiteId) ?? {}) },
    });
    if (result.count > 0) {
      repointed[`${step.model}.${step.field}`] =
        (repointed[`${step.model}.${step.field}`] ?? 0) + result.count;
    }
  }
  await delegate(tx, "customerSite").update({
    where: { id: loserSiteId },
    data: { status: TOMBSTONE, mergedIntoId: survivorSiteId },
  });
}
