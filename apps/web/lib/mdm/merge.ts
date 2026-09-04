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
import { loadMatchConfig } from "./match-config";
import { recordAttributeChanges } from "./history";

export type MergeableDomain = "customer-account" | "customer-site" | "customer-contact";

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
  /**
   * Tombstone semantics differ per domain: account/site rows carry a status
   * union; contacts are identity-bearing (no status) and tombstone via
   * isActive=false + mergedIntoId.
   */
  isTombstoned: (row: Record<string, unknown>) => boolean;
  tombstoneData: (survivorId: string) => Record<string, unknown>;
  /**
   * Fields eligible for fill-empty survivorship (BI-16450BB2): survivor keeps
   * its values; empty survivor fields are filled from the loser and audited.
   */
  survivorshipFields: readonly string[];
};

const statusTombstone = {
  isTombstoned: (row: Record<string, unknown>) => row["status"] === CUSTOMER_TOMBSTONE_STATUSES[0],
  tombstoneData: (survivorId: string) => ({
    status: CUSTOMER_TOMBSTONE_STATUSES[0],
    mergedIntoId: survivorId,
  }),
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
    // Mileage attributed to a customer follows the surviving account (BI-E17E0034):
    // a job-costed or rebillable trip must not strand on a tombstoned account.
    { model: "trip", field: "customerAccountId" },
    {
      model: "masterDataSourceRef",
      field: "customerAccountId",
      // CHECK constraint: typed FK must equal canonicalId for this domain.
      alsoSet: (survivorId) => ({ canonicalId: survivorId }),
    },
    { model: "recurringSchedule", field: "accountId" },
    { model: "subscription", field: "accountId" },
    { model: "discoveryConnection", field: "customerAccountId" },
    { model: "edgeNode", field: "customerAccountId" },
    { model: "bootstrapToken", field: "targetCustomerAccountId" },
    { model: "memberEquityEntry", field: "memberAccountId" },
    { model: "productSoldParty", field: "accountId" },
    { model: "productSoldEntitlement", field: "accountId" },
  ],
  softReferences: [
    { model: "remoteAction", field: "customerAccountId" },
    { model: "securityEvent", field: "customerAccountId" },
    { model: "detection", field: "customerAccountId" },
    { model: "securityCase", field: "customerAccountId" },
    { model: "journalLine", field: "customerAccountId" },
  ],
  ...statusTombstone,
  survivorshipFields: ["website", "industry", "employeeCount", "annualRevenue", "notes"],
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
  ...statusTombstone,
  survivorshipFields: ["timezone", "accessInstructions", "hoursNotes", "serviceNotes"],
};

// Contacts are identity-bearing (passwordHash, social identities, unique
// email) — a contact merge is a Principal convergence (BI-F71DBE84): the
// survivor keeps its credentials and email; the loser keeps its own email on
// the tombstone row (email stays unique), isActive=false, mergedIntoId set.
const CUSTOMER_CONTACT_ADAPTER: MergeAdapter = {
  domain: "customer-contact",
  model: "customerContact",
  hardRelations: [
    { model: "socialIdentity", field: "contactId" },
    { model: "contactAccountRole", field: "contactId" },
    { model: "engagement", field: "contactId" },
    { model: "opportunity", field: "contactId" },
    { model: "activity", field: "contactId" },
    { model: "rentalAgreement", field: "customerContactId" },
    { model: "invoice", field: "contactId" },
    { model: "productSoldParty", field: "contactId" },
    { model: "productSoldEntitlement", field: "contactId" },
  ],
  softReferences: [{ model: "journalLine", field: "contactId" }],
  isTombstoned: (row) => row["mergedIntoId"] != null,
  tombstoneData: (survivorId) => ({ isActive: false, mergedIntoId: survivorId }),
  survivorshipFields: ["phone", "jobTitle", "linkedinUrl", "firstName", "lastName"],
};

export const MERGE_ADAPTERS: Readonly<Record<MergeableDomain, MergeAdapter>> = {
  "customer-account": CUSTOMER_ACCOUNT_ADAPTER,
  "customer-site": CUSTOMER_SITE_ADAPTER,
  "customer-contact": CUSTOMER_CONTACT_ADAPTER,
};

export type MergeResult = {
  domain: MergeableDomain;
  loserId: string;
  survivorId: string;
  /** Rows repointed per model.field step. */
  repointed: Record<string, number>;
  /**
   * Ids of the repointed rows per step (capped at UNMERGE_ID_CAP each) — the
   * lineage unmerge needs to restore exactly what moved (BI-F7B6D55E).
   */
  repointedIds: Record<string, string[]>;
  /** Steps whose id list hit the cap; unmerge refuses these (lossy lineage). */
  repointedIdsTruncated: string[];
  /** Loser sites merged into same-named survivor sites (account merges). */
  nestedSiteMerges: Array<{ loserSiteId: string; survivorSiteId: string; priorStatus: string }>;
  /** Pre-merge snapshot of the loser row (tombstone keeps it too). */
  loserSnapshot: Record<string, unknown>;
  /** Fields filled onto the survivor from the loser (fill-empty survivorship). */
  survivorship: Record<string, string>;
};

/** Per-step lineage cap: above this an unmerge would be lossy, so we refuse. */
const UNMERGE_ID_CAP = 1000;

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
  const config = await loadMatchConfig(domain);

  const result = await prisma.$transaction(async (tx) => {
    const canonical = delegate(tx, adapter.model);
    const [loser, survivor] = await Promise.all([
      canonical.findUnique({ where: { id: loserId } }),
      canonical.findUnique({ where: { id: survivorId } }),
    ]);
    if (!loser || !survivor) throw new MergeValidationFailure("not-found");
    if (adapter.isTombstoned(loser) || adapter.isTombstoned(survivor)) {
      throw new MergeValidationFailure("already-superseded");
    }

    const repointed: Record<string, number> = {};
    const repointedIds: Record<string, string[]> = {};
    const repointedIdsTruncated: string[] = [];
    const nestedSiteMerges: MergeResult["nestedSiteMerges"] = [];

    const recordIds = (stepKey: string, ids: string[]) => {
      if (ids.length === 0) return;
      const existing = repointedIds[stepKey] ?? [];
      const merged = existing.concat(ids);
      if (merged.length > UNMERGE_ID_CAP) {
        repointedIds[stepKey] = merged.slice(0, UNMERGE_ID_CAP);
        if (!repointedIdsTruncated.includes(stepKey)) repointedIdsTruncated.push(stepKey);
      } else {
        repointedIds[stepKey] = merged;
      }
    };

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
          select: { id: true, nameNormalized: true, status: true },
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
          await mergeSiteWithinTx(tx, site["id"] as string, collision, repointed, recordIds);
          nestedSiteMerges.push({
            loserSiteId: site["id"] as string,
            survivorSiteId: collision,
            priorStatus: (site["status"] as string | undefined) ?? "active",
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

    if (domain === "customer-contact") {
      const roleDelegate = delegate(tx, "contactAccountRole");
      const [loserRoles, survivorRoles] = await Promise.all([
        roleDelegate.findMany({
          where: { contactId: loserId },
          select: { id: true, accountId: true, startedAt: true },
        }),
        roleDelegate.findMany({
          where: { contactId: survivorId },
          select: { accountId: true, startedAt: true },
        }),
      ]);
      const survivorRoleKeys = new Set(
        survivorRoles.map((r) => `${r["accountId"]}|${(r["startedAt"] as Date).toISOString()}`),
      );
      const collidingRoleIds = loserRoles
        .filter((r) =>
          survivorRoleKeys.has(`${r["accountId"]}|${(r["startedAt"] as Date).toISOString()}`),
        )
        .map((r) => r["id"] as string);
      if (collidingRoleIds.length > 0) {
        const dropped = await roleDelegate.deleteMany({ where: { id: { in: collidingRoleIds } } });
        repointed["contactAccountRole.dropped-duplicates"] = dropped.count;
      }
    }

    // Repoint every declared hard relation and soft reference, recording the
    // moved row ids so unmerge can restore exactly this set.
    for (const step of [...adapter.hardRelations, ...adapter.softReferences]) {
      // Skip the self-referencing tombstone pointer on the canonical model
      // itself for the loser row (set below), but DO repoint other rows.
      const where: Record<string, unknown> = { [step.field]: loserId };
      if (step.model === adapter.model) where["id"] = { not: loserId };
      const stepKey = `${step.model}.${step.field}`;
      const moving = await delegate(tx, step.model).findMany({
        where,
        select: { id: true },
      });
      const result = await delegate(tx, step.model).updateMany({
        where,
        data: { [step.field]: survivorId, ...(step.alsoSet?.(survivorId) ?? {}) },
      });
      if (result.count > 0) {
        repointed[stepKey] = (repointed[stepKey] ?? 0) + result.count;
        recordIds(stepKey, moving.map((r) => r["id"] as string));
      }
    }

    // Fill-empty survivorship (BI-16450BB2): survivor keeps its values;
    // empty survivor fields are completed from the loser, audited per field.
    const survivorship: Record<string, string> = {};
    if (config.survivorship === "fill-empty") {
      const fills: Record<string, unknown> = {};
      for (const field of adapter.survivorshipFields) {
        const survivorValue = survivor[field];
        const loserValue = loser[field];
        const survivorEmpty =
          survivorValue === null || survivorValue === undefined || survivorValue === "";
        const loserHasValue = loserValue !== null && loserValue !== undefined && loserValue !== "";
        if (survivorEmpty && loserHasValue) {
          fills[field] = loserValue;
          survivorship[field] = String(loserValue);
        }
      }
      if (Object.keys(fills).length > 0) {
        await canonical.update({ where: { id: survivorId }, data: fills });
      }
    }

    // Tombstone the loser: link + supersede, never delete.
    await canonical.update({
      where: { id: loserId },
      data: adapter.tombstoneData(survivorId),
    });

    return {
      domain,
      loserId,
      survivorId,
      repointed,
      repointedIds,
      repointedIdsTruncated,
      nestedSiteMerges,
      loserSnapshot: loser,
      survivorship,
    };
  });

  // Attribute history (append-only, best-effort): survivor fills + loser tombstone.
  if (Object.keys(result.survivorship).length > 0) {
    await recordAttributeChanges({
      domain,
      entityId: survivorId,
      before: Object.fromEntries(Object.keys(result.survivorship).map((f) => [f, null])),
      after: result.survivorship,
      attributes: Object.keys(result.survivorship),
      source: "merge",
    });
  }
  await recordAttributeChanges({
    domain,
    entityId: loserId,
    before: { mergedIntoId: null },
    after: { mergedIntoId: survivorId },
    attributes: ["mergedIntoId"],
    source: "merge",
  });
  return result;
}

/** Merge one site into another inside an outer account-merge transaction. */
async function mergeSiteWithinTx(
  tx: Tx,
  loserSiteId: string,
  survivorSiteId: string,
  repointed: Record<string, number>,
  recordIds: (stepKey: string, ids: string[]) => void,
): Promise<void> {
  const adapter = CUSTOMER_SITE_ADAPTER;
  for (const step of [...adapter.hardRelations, ...adapter.softReferences]) {
    const stepKey = `site:${loserSiteId}:${step.model}.${step.field}`;
    const moving = await delegate(tx, step.model).findMany({
      where: { [step.field]: loserSiteId },
      select: { id: true },
    });
    const result = await delegate(tx, step.model).updateMany({
      where: { [step.field]: loserSiteId },
      data: { [step.field]: survivorSiteId, ...(step.alsoSet?.(survivorSiteId) ?? {}) },
    });
    if (result.count > 0) {
      repointed[`${step.model}.${step.field}`] =
        (repointed[`${step.model}.${step.field}`] ?? 0) + result.count;
      recordIds(stepKey, moving.map((r) => r["id"] as string));
    }
  }
  await delegate(tx, "customerSite").update({
    where: { id: loserSiteId },
    data: { status: TOMBSTONE, mergedIntoId: survivorSiteId },
  });
}

export type UnmergeError =
  | "not-merged"
  | "no-audit"
  | "lossy-lineage"
  | "survivor-mismatch";

export class UnmergeValidationFailure extends Error {
  constructor(public readonly reason: UnmergeError) {
    super(`unmerge validation failed: ${reason}`);
  }
}

export type UnmergeResult = {
  loserId: string;
  survivorId: string;
  restored: Record<string, number>;
  restoredStatus: string;
};

/**
 * Reverse an account merge using the recorded lineage (BI-F7B6D55E).
 *
 * Restores exactly the rows the merge moved (by recorded id); rows attached
 * to the survivor AFTER the merge stay with the survivor — that is the
 * correct semantic, not a limitation. Refuses when lineage was truncated
 * (UNMERGE_ID_CAP) or no audit activity exists. customer-account only: the
 * audit Activity row is the lineage store, and only account merges write one.
 */
export async function unmergeRecords(loserId: string): Promise<UnmergeResult> {
  const loser = await prisma.customerAccount.findUnique({
    where: { id: loserId },
    select: { id: true, status: true, mergedIntoId: true },
  });
  if (!loser || loser.status !== TOMBSTONE || !loser.mergedIntoId) {
    throw new UnmergeValidationFailure("not-merged");
  }
  const survivorId = loser.mergedIntoId;

  // The merge audit is the lineage store: latest account_merged activity on
  // the survivor whose payload names this loser.
  const audits = await prisma.activity.findMany({
    where: { type: "account_merged", accountId: survivorId },
    orderBy: { createdAt: "desc" },
    select: { id: true, body: true },
    take: 25,
  });
  let lineage: MergeResult | null = null;
  for (const audit of audits) {
    try {
      const parsed = JSON.parse(audit.body ?? "") as MergeResult;
      if (parsed.loserId === loserId && parsed.survivorId === survivorId) {
        lineage = parsed;
        break;
      }
    } catch {
      // Non-JSON or legacy audit body — keep scanning.
    }
  }
  if (!lineage) throw new UnmergeValidationFailure("no-audit");
  if ((lineage.repointedIdsTruncated ?? []).length > 0) {
    throw new UnmergeValidationFailure("lossy-lineage");
  }

  const restoredStatus =
    typeof lineage.loserSnapshot?.["status"] === "string"
      ? (lineage.loserSnapshot["status"] as string)
      : "prospect";

  return prisma.$transaction(async (tx) => {
    const restored: Record<string, number> = {};

    // Un-tombstone the loser FIRST so restored FKs point at a live row.
    await delegate(tx, "customerAccount").update({
      where: { id: loserId },
      data: { status: restoredStatus, mergedIntoId: null },
    });

    for (const [stepKey, ids] of Object.entries(lineage.repointedIds ?? {})) {
      if (ids.length === 0) continue;
      const isNestedSite = stepKey.startsWith("site:");
      const [model, field] = (isNestedSite ? stepKey.split(":")[2]! : stepKey).split(".");
      if (!model || !field) continue;
      const backTo = isNestedSite ? stepKey.split(":")[1]! : loserId;
      const isCrosswalk = model === "masterDataSourceRef";
      const result = await delegate(tx, model).updateMany({
        where: { id: { in: ids } },
        data: { [field]: backTo, ...(isCrosswalk ? { canonicalId: backTo } : {}) },
      });
      if (result.count > 0) {
        restored[stepKey] = result.count;
      }
    }

    // Restore nested-merged sites to their prior status.
    for (const nested of lineage.nestedSiteMerges ?? []) {
      await delegate(tx, "customerSite").update({
        where: { id: nested.loserSiteId },
        data: { status: nested.priorStatus, mergedIntoId: null },
      });
      restored[`site-restored:${nested.loserSiteId}`] = 1;
    }

    return { loserId, survivorId, restored, restoredStatus };
  });
}
