"use server";

import { Prisma, prisma } from "@dpf/db";
import { registerCustomerAccountSource } from "@/lib/mdm/crosswalk";
import crypto from "crypto";
import { STAGE_DEFAULT_PROBABILITY } from "@dpf/validators";
import { revalidatePath } from "next/cache";
import { generateInvoiceFromSalesOrder } from "@/lib/actions/finance";
import {
  appendProductSoldEvidence,
  createProductSoldDraft,
  createProductSoldPartyLinks,
  materializeProductSold,
  persistProductSoldComponentAllocations,
  persistProductSoldPartyLinks,
  snapshotProductSoldComponents,
} from "@/lib/products/product-sold";
import {
  checkCustomerAccountDuplicates,
  customerAccountNormalizedColumns,
  resolveDedupDecision,
  type DedupCheckResult,
  type DedupResolution,
} from "@/lib/mdm/dedup-gate";

import {
  searchCustomerSiteAddresses as searchCustomerSiteAddressesImpl,
  createCustomerSite as createCustomerSiteImpl,
  updateCustomerSite as updateCustomerSiteImpl,
} from "./customer-sites";
import {
  buildCustomerConfigurationItemLifecycleState,
  calcLineTotal,
  readLifecycleEvidenceField,
  requiredTrimmed,
  trimOrNull,
  type CustomerConfigurationItemInput,
} from "@/lib/crm/crm-core";

// Thin async wrappers — "use server" files may only export async functions
// (no `export { … } from` re-exports; that zeroes the whole module in Turbopack).
export async function searchCustomerSiteAddresses(
  ...args: Parameters<typeof searchCustomerSiteAddressesImpl>
) {
  return searchCustomerSiteAddressesImpl(...args);
}

export async function createCustomerSite(
  ...args: Parameters<typeof createCustomerSiteImpl>
) {
  return createCustomerSiteImpl(...args);
}

export async function updateCustomerSite(
  ...args: Parameters<typeof updateCustomerSiteImpl>
) {
  return updateCustomerSiteImpl(...args);
}

// ─── Activity Logging (used by all other actions) ───────────────────────────

export async function logActivity(input: {
  type: string;
  subject: string;
  body?: string;
  scheduledAt?: string;
  completedAt?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  createdById?: string | null;
}) {
  return prisma.activity.create({
    data: {
      activityId: `ACT-${crypto.randomUUID()}`,
      type: input.type,
      subject: input.subject,
      body: input.body || null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      completedAt: input.completedAt ? new Date(input.completedAt) : null,
      accountId: input.accountId || null,
      contactId: input.contactId || null,
      opportunityId: input.opportunityId || null,
      createdById: input.createdById || null,
    },
  });
}

/** Auto-log a system event (no user attribution) */
async function logSystemActivity(
  subject: string,
  opts: {
    type?: string;
    body?: string;
    accountId?: string;
    contactId?: string;
    opportunityId?: string;
  } = {},
) {
  return logActivity({
    type: opts.type || "system",
    subject,
    body: opts.body,
    accountId: opts.accountId,
    contactId: opts.contactId,
    opportunityId: opts.opportunityId,
    createdById: null,
  });
}

// ─── Customer Account Actions ───────────────────────────────────────────────

export type CreateCustomerAccountResult =
  | { outcome: "created"; account: Awaited<ReturnType<typeof prisma.customerAccount.create>> }
  | { outcome: "existing"; account: Awaited<ReturnType<typeof prisma.customerAccount.create>> }
  | { outcome: "duplicates-found"; check: DedupCheckResult };

/**
 * Gated create (MDM write-time dedup, EP-4A12A7CB WG-2): checks for likely /
 * possible duplicates BEFORE insert and forces a use-existing / confirm-new
 * decision instead of silently creating. Registered in GATED_CREATE_PATHS.
 */
export async function createCustomerAccount(
  input: {
    name: string;
    website?: string;
    industry?: string;
    notes?: string;
    status?: string;
  },
  dedup?: DedupResolution,
): Promise<CreateCustomerAccountResult> {
  const check = await checkCustomerAccountDuplicates({
    name: input.name,
    website: input.website,
  });
  const decision = resolveDedupDecision(check, dedup);
  if (decision.action === "use-existing") {
    const existing = await prisma.customerAccount.findUniqueOrThrow({
      where: { id: decision.existingId },
    });
    await logSystemActivity(
      `Duplicate account creation avoided — using existing "${existing.name}"`,
      { type: "account_dedup_use_existing", accountId: existing.id },
    );
    return { outcome: "existing", account: existing };
  }
  if (decision.action === "needs-resolution") {
    return { outcome: "duplicates-found", check };
  }

  const accountId = `ACCT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const account = await prisma.customerAccount.create({
    data: {
      accountId,
      name: input.name,
      ...customerAccountNormalizedColumns({ name: input.name, website: input.website }),
      status: input.status || "prospect",
      website: input.website || null,
      industry: input.industry || null,
      notes: input.notes || null,
      currency: "USD",
    },
  });
  await logSystemActivity(
    decision.overrideReason
      ? `Customer account "${account.name}" created (duplicate override: ${decision.overrideReason})`
      : `Customer account "${account.name}" created`,
    {
      type: "account_created",
      accountId: account.id,
    },
  );
  // Source lineage (BI-A4B73F87): register where this record came from.
  await registerCustomerAccountSource({
    accountId: account.id,
    sourceSystem: "portal-ui",
    sourceEntityId: account.id,
  });

  revalidatePath("/customer");
  return { outcome: "created", account };
}

export async function createCustomerSiteNode(input: {
  accountId: string;
  siteId: string;
  parentNodeId?: string;
  name: string;
  nodeType?: string;
  status?: string;
  notes?: string;
}) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Node name is required");
  }

  const node = await prisma.customerSiteNode.create({
    data: {
      nodeId: `SITE-NODE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      siteId: input.siteId,
      parentNodeId: input.parentNodeId || null,
      name,
      nodeType: input.nodeType?.trim() || "area",
      status: input.status?.trim() || "active",
      notes: input.notes?.trim() || null,
    },
  });

  revalidatePath(`/customer/${input.accountId}`);
  return node;
}

export async function createCustomerConfigurationItem(input: CustomerConfigurationItemInput & {
  accountId: string;
}) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Configuration item name is required");
  }

  const ciType = input.ciType.trim();
  if (!ciType) {
    throw new Error("Configuration item type is required");
  }
  const lifecycleState = buildCustomerConfigurationItemLifecycleState({
    ...input,
    name,
    ciType,
  });

  const configurationItem = await prisma.customerConfigurationItem.create({
    data: {
      customerCiId: `CCI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      accountId: input.accountId,
      siteId: input.siteId || null,
      name,
      ciType,
      status: input.status?.trim() || "active",
      technologySourceType: input.technologySourceType || "commercial",
      supportModel: lifecycleState.supportModel,
      manufacturer: lifecycleState.manufacturer,
      normalizedVersion: lifecycleState.normalizedVersion,
      observedVersion: lifecycleState.observedVersion,
      billingCadence: lifecycleState.billingCadence,
      customerChargeModel: lifecycleState.customerChargeModel,
      renewalDate: lifecycleState.renewalDate,
      endOfSupportAt: lifecycleState.endOfSupportAt,
      endOfLifeAt: lifecycleState.endOfLifeAt,
      warrantyEndAt: lifecycleState.warrantyEndAt,
      licenseQuantity: input.licenseQuantity ?? null,
      lifecycleStatus: lifecycleState.lifecycleStatus,
      supportStatus: lifecycleState.supportStatus,
      recommendedAction: lifecycleState.recommendedAction,
      lifecycleConfidence: lifecycleState.lifecycleConfidence,
      lastLifecycleReviewAt: lifecycleState.lastLifecycleReviewAt,
      nextLifecycleReviewAt: lifecycleState.nextLifecycleReviewAt,
      lifecycleEvidence: lifecycleState.lifecycleEvidence,
    },
  });

  await logSystemActivity(`Customer configuration item "${configurationItem.name}" created`, {
    type: "account_created",
    accountId: input.accountId,
  });

  revalidatePath("/customer");
  revalidatePath(`/customer/${input.accountId}`);
  return configurationItem;
}

export async function updateCustomerConfigurationItem(input: CustomerConfigurationItemInput & {
  accountId: string;
  configurationItemId: string;
}) {
  const existing = await prisma.customerConfigurationItem.findUnique({
    where: { id: input.configurationItemId },
    select: {
      id: true,
      accountId: true,
      name: true,
      siteId: true,
      ciType: true,
      technologySourceType: true,
      supportModel: true,
      manufacturer: true,
      normalizedVersion: true,
      observedVersion: true,
      billingCadence: true,
      customerChargeModel: true,
      renewalDate: true,
      endOfSupportAt: true,
      endOfLifeAt: true,
      warrantyEndAt: true,
      licenseQuantity: true,
      status: true,
      lifecycleEvidence: true,
    },
  });

  if (!existing || existing.accountId !== input.accountId) {
    throw new Error("Configuration item not found for this account");
  }

  const name = (input.name ?? existing.name).trim();
  if (!name) {
    throw new Error("Configuration item name is required");
  }

  const ciType = (input.ciType ?? existing.ciType).trim();
  if (!ciType) {
    throw new Error("Configuration item type is required");
  }

  const lifecycleState = buildCustomerConfigurationItemLifecycleState({
    siteId: input.siteId !== undefined ? input.siteId : existing.siteId ?? undefined,
    name,
    ciType,
    technologySourceType: input.technologySourceType ?? (existing.technologySourceType as "commercial" | "open_source" | "hybrid"),
    supportModel: input.supportModel !== undefined ? input.supportModel : existing.supportModel ?? undefined,
    manufacturer: input.manufacturer !== undefined ? input.manufacturer : existing.manufacturer ?? undefined,
    normalizedVersion: input.normalizedVersion !== undefined ? input.normalizedVersion : existing.normalizedVersion ?? undefined,
    observedVersion: input.observedVersion !== undefined ? input.observedVersion : existing.observedVersion ?? undefined,
    billingCadence: input.billingCadence !== undefined ? input.billingCadence : existing.billingCadence ?? undefined,
    customerChargeModel:
      input.customerChargeModel !== undefined ? input.customerChargeModel : existing.customerChargeModel ?? undefined,
    renewalDate: input.renewalDate !== undefined ? input.renewalDate : existing.renewalDate,
    endOfSupportAt: input.endOfSupportAt !== undefined ? input.endOfSupportAt : existing.endOfSupportAt,
    endOfLifeAt: input.endOfLifeAt !== undefined ? input.endOfLifeAt : existing.endOfLifeAt,
    warrantyEndAt: input.warrantyEndAt !== undefined ? input.warrantyEndAt : existing.warrantyEndAt,
    reviewCadenceDays: input.reviewCadenceDays,
    licenseQuantity: input.licenseQuantity !== undefined ? input.licenseQuantity : Number(existing.licenseQuantity ?? 0) || null,
    status: input.status !== undefined ? input.status : existing.status,
    evidenceSource:
      input.evidenceSource !== undefined
        ? input.evidenceSource
        : readLifecycleEvidenceField(existing.lifecycleEvidence, "source"),
    evidenceNotes:
      input.evidenceNotes !== undefined
        ? input.evidenceNotes
        : readLifecycleEvidenceField(existing.lifecycleEvidence, "notes"),
  });

  const updated = await prisma.customerConfigurationItem.update({
    where: { id: input.configurationItemId },
    data: {
      siteId: input.siteId !== undefined ? input.siteId || null : existing.siteId ?? null,
      name,
      ciType,
      status: input.status?.trim() || existing.status,
      technologySourceType: input.technologySourceType ?? existing.technologySourceType,
      supportModel: lifecycleState.supportModel,
      manufacturer: lifecycleState.manufacturer,
      normalizedVersion: lifecycleState.normalizedVersion,
      observedVersion: lifecycleState.observedVersion,
      billingCadence: lifecycleState.billingCadence,
      customerChargeModel: lifecycleState.customerChargeModel,
      renewalDate: lifecycleState.renewalDate,
      endOfSupportAt: lifecycleState.endOfSupportAt,
      endOfLifeAt: lifecycleState.endOfLifeAt,
      warrantyEndAt: lifecycleState.warrantyEndAt,
      licenseQuantity:
        input.licenseQuantity !== undefined ? input.licenseQuantity : existing.licenseQuantity,
      lifecycleStatus: lifecycleState.lifecycleStatus,
      supportStatus: lifecycleState.supportStatus,
      recommendedAction: lifecycleState.recommendedAction,
      lifecycleConfidence: lifecycleState.lifecycleConfidence,
      lastLifecycleReviewAt: lifecycleState.lastLifecycleReviewAt,
      nextLifecycleReviewAt: lifecycleState.nextLifecycleReviewAt,
      lifecycleEvidence: lifecycleState.lifecycleEvidence,
    },
  });

  await logSystemActivity(`Customer configuration item "${updated.name}" updated`, {
    type: "account_created",
    accountId: input.accountId,
  });

  revalidatePath("/customer");
  revalidatePath(`/customer/${input.accountId}`);
  return updated;
}

// ─── Engagement Actions ─────────────────────────────────────────────────────

export async function createEngagement(input: {
  title: string;
  contactId: string;
  accountId?: string;
  source?: string;
  sourceRefId?: string;
  assignedToId?: string;
  notes?: string;
  userId?: string;
}) {
  const engagement = await prisma.engagement.create({
    data: {
      engagementId: `ENG-${crypto.randomUUID()}`,
      title: input.title.trim(),
      status: "new",
      contactId: input.contactId,
      accountId: input.accountId || null,
      source: input.source || null,
      sourceRefId: input.sourceRefId || null,
      assignedToId: input.assignedToId || null,
      notes: input.notes?.trim() || null,
    },
    include: {
      contact: true,
      account: true,
      assignedTo: { select: { id: true, email: true } },
    },
  });

  // Auto-log
  await logSystemActivity(
    `Engagement "${engagement.title}" created`,
    {
      type: "status_change",
      accountId: engagement.accountId || undefined,
      contactId: engagement.contactId,
    },
  );

  return engagement;
}

export type RouteAcquisitionSignalToEngagementInput = {
  title: string;
  contactId: string;
  accountId?: string | null;
  source: string;
  sourceRefId: string;
  assignedToId?: string | null;
  notes?: string | null;
  userId?: string;
};

export type RouteAcquisitionSignalToEngagementResult = {
  status: "created" | "linked";
  engagementId: string;
  engagementTitle: string;
};

export async function routeAcquisitionSignalToEngagement(
  input: RouteAcquisitionSignalToEngagementInput,
): Promise<RouteAcquisitionSignalToEngagementResult> {
  const title = requiredTrimmed(input.title, "Engagement title");
  const contactId = requiredTrimmed(input.contactId, "Contact id");
  const source = requiredTrimmed(input.source, "Signal source");
  const sourceRefId = requiredTrimmed(input.sourceRefId, "Signal source reference");
  const requestedAccountId = trimOrNull(input.accountId);

  const contact = await prisma.customerContact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      accountId: true,
    },
  });

  if (!contact) {
    throw new Error("Signal contact was not found");
  }

  const accountId = requestedAccountId ?? contact.accountId;
  if (requestedAccountId && requestedAccountId !== contact.accountId) {
    throw new Error("Signal contact does not belong to the selected account");
  }

  const existing = await prisma.engagement.findFirst({
    where: {
      OR: [
        { source, sourceRefId },
        {
          accountId,
          contactId,
          source,
          title,
        },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
    },
  });

  if (existing) {
    return {
      status: "linked",
      engagementId: existing.id,
      engagementTitle: existing.title,
    };
  }

  const engagement = await createEngagement({
    title,
    contactId,
    accountId,
    source,
    sourceRefId,
    assignedToId: trimOrNull(input.assignedToId) ?? undefined,
    notes: trimOrNull(input.notes) ?? undefined,
    userId: input.userId,
  });

  return {
    status: "created",
    engagementId: engagement.id,
    engagementTitle: engagement.title,
  };
}

export async function createEngagementFromSignalForm(formData: FormData) {
  const result = await routeAcquisitionSignalToEngagement({
    title: String(formData.get("title") ?? ""),
    contactId: String(formData.get("contactId") ?? ""),
    accountId: String(formData.get("accountId") ?? ""),
    source: String(formData.get("source") ?? ""),
    sourceRefId: String(formData.get("sourceRefId") ?? ""),
    assignedToId: String(formData.get("assignedToId") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  revalidatePath("/customer");
  revalidatePath("/customer/engagements");
  revalidatePath("/customer/marketing");

  return result;
}

export async function qualifyEngagement(
  engagementId: string,
  opts: {
    opportunityTitle?: string;
    expectedValue?: number;
    expectedClose?: string;
    userId?: string;
  } = {},
) {
  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    include: { contact: true, account: true },
  });
  if (!engagement) throw new Error("Engagement not found");
  if (engagement.status === "converted")
    throw new Error("Engagement already converted");

  if (!engagement.accountId) {
    throw new Error(
      "Engagement must be linked to an account before qualification",
    );
  }

  // Create opportunity and update engagement in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const opportunity = await tx.opportunity.create({
      data: {
        opportunityId: `OPP-${crypto.randomUUID()}`,
        title:
          opts.opportunityTitle?.trim() ||
          engagement.title,
        stage: "qualification",
        probability: 10,
        accountId: engagement.accountId!,
        contactId: engagement.contactId,
        assignedToId: engagement.assignedToId,
        engagementId: engagement.id,
        expectedValue: opts.expectedValue ?? null,
        expectedClose: opts.expectedClose
          ? new Date(opts.expectedClose)
          : null,
      },
      include: {
        account: true,
        contact: true,
        assignedTo: { select: { id: true, email: true } },
        activities: true,
      },
    });

    await tx.engagement.update({
      where: { id: engagementId },
      data: {
        status: "converted",
        convertedToId: opportunity.id,
      },
    });

    return opportunity;
  });

  // Auto-log
  await logSystemActivity(
    `Engagement qualified → Opportunity "${result.title}" created`,
    {
      type: "status_change",
      accountId: result.accountId,
      contactId: result.contactId || undefined,
      opportunityId: result.id,
    },
  );

  return result;
}

// ─── Opportunity Actions ────────────────────────────────────────────────────

export async function createOpportunity(input: {
  title: string;
  accountId: string;
  contactId?: string;
  stage?: string;
  probability?: number;
  expectedValue?: number;
  currency?: string;
  expectedClose?: string;
  assignedToId?: string;
  engagementId?: string;
  notes?: string;
  userId?: string;
}) {
  const stage = input.stage || "qualification";
  const probability =
    input.probability ?? STAGE_DEFAULT_PROBABILITY[stage] ?? 10;

  const opportunity = await prisma.opportunity.create({
    data: {
      opportunityId: `OPP-${crypto.randomUUID()}`,
      title: input.title.trim(),
      stage,
      probability,
      accountId: input.accountId,
      contactId: input.contactId || null,
      assignedToId: input.assignedToId || null,
      engagementId: input.engagementId || null,
      expectedValue: input.expectedValue ?? null,
      currency: input.currency || "USD",
      expectedClose: input.expectedClose
        ? new Date(input.expectedClose)
        : null,
      notes: input.notes?.trim() || null,
    },
    include: {
      account: true,
      contact: true,
      assignedTo: { select: { id: true, email: true } },
      activities: true,
    },
  });

  await logSystemActivity(
    `Opportunity "${opportunity.title}" created in ${stage}`,
    {
      type: "status_change",
      accountId: opportunity.accountId,
      contactId: opportunity.contactId || undefined,
      opportunityId: opportunity.id,
    },
  );

  return opportunity;
}

export async function advanceOpportunityStage(
  opportunityId: string,
  newStage: string,
  opts: { probability?: number; userId?: string } = {},
) {
  const opp = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
  });
  if (!opp) throw new Error("Opportunity not found");

  const oldStage = opp.stage;
  if (oldStage === newStage) return opp;

  const probability =
    opts.probability ?? STAGE_DEFAULT_PROBABILITY[newStage] ?? opp.probability;

  const updated = await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      stage: newStage,
      probability,
      stageChangedAt: new Date(),
      isDormant: false, // Reset dormant on stage change
      ...(newStage === "closed_won" && { actualClose: new Date() }),
      ...(newStage === "closed_lost" && { actualClose: new Date() }),
    },
    include: {
      account: true,
      contact: true,
      assignedTo: { select: { id: true, email: true } },
      activities: true,
    },
  });

  await logSystemActivity(
    `Opportunity stage: ${oldStage} -> ${newStage} (${probability}%)`,
    {
      type: "status_change",
      accountId: updated.accountId,
      contactId: updated.contactId || undefined,
      opportunityId: updated.id,
    },
  );

  revalidatePath("/customer/opportunities");
  revalidatePath(`/customer/opportunities/${updated.id}`);
  revalidatePath(`/customer/${updated.accountId}`);

  return updated;
}

export async function updateOpportunityStageFromForm(formData: FormData) {
  const opportunityId = String(formData.get("opportunityId") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();

  if (!opportunityId) {
    throw new Error("Opportunity id is required");
  }
  if (!stage) {
    throw new Error("Stage is required");
  }

  await advanceOpportunityStage(opportunityId, stage);
}

export async function closeOpportunity(
  opportunityId: string,
  won: boolean,
  opts: { lostReason?: string; userId?: string } = {},
) {
  const stage = won ? "closed_won" : "closed_lost";
  const opp = await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      stage,
      probability: won ? 100 : 0,
      actualClose: new Date(),
      stageChangedAt: new Date(),
      isDormant: false,
      lostReason: won ? null : (opts.lostReason?.trim() || null),
    },
    include: {
      account: true,
      contact: true,
      assignedTo: { select: { id: true, email: true } },
      activities: true,
    },
  });

  await logSystemActivity(
    won
      ? `Opportunity closed WON`
      : `Opportunity closed LOST${opts.lostReason ? `: ${opts.lostReason}` : ""}`,
    {
      type: "status_change",
      accountId: opp.accountId,
      contactId: opp.contactId || undefined,
      opportunityId: opp.id,
    },
  );

  return opp;
}

// ─── Dormant Deal Detection ─────────────────────────────────────────────────

const DORMANT_THRESHOLD_DAYS = 45;

export async function flagDormantOpportunities() {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - DORMANT_THRESHOLD_DAYS);

  const stale = await prisma.opportunity.findMany({
    where: {
      isDormant: false,
      stage: { notIn: ["closed_won", "closed_lost"] },
      stageChangedAt: { lt: threshold },
    },
    select: { id: true, accountId: true, contactId: true, title: true },
  });

  for (const opp of stale) {
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { isDormant: true },
    });

    await logSystemActivity(
      `Opportunity "${opp.title}" marked dormant (no stage change in ${DORMANT_THRESHOLD_DAYS} days)`,
      {
        type: "system",
        accountId: opp.accountId,
        contactId: opp.contactId || undefined,
        opportunityId: opp.id,
      },
    );
  }

  return { flagged: stale.length };
}

// ─── Quote Actions ──────────────────────────────────────────────────────────

/** Generate sequential quote number: QUO-YYYY-NNNN */
async function nextQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('quote_number_seq')`,
  );
  const seq = Number(result[0]!.nextval);
  return `QUO-${year}-${String(seq).padStart(4, "0")}`;
}

/** Generate sequential sales order ref: SO-YYYY-NNNN */
async function nextSalesOrderRef(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('sales_order_number_seq')`,
  );
  const seq = Number(result[0]!.nextval);
  return `SO-${year}-${String(seq).padStart(4, "0")}`;
}

export async function createQuote(input: {
  opportunityId: string;
  validUntil: string;
  lineItems: {
    productId?: string;
    catalogItemId?: string;
    catalogSkuId?: string;
    configurationSnapshot?: Prisma.InputJsonObject;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    taxPercent?: number;
    sortOrder?: number;
  }[];
  discountType?: string;
  discountValue?: number;
  currency?: string;
  terms?: string;
  notes?: string;
  userId?: string;
}) {
  const opp = await prisma.opportunity.findUnique({
    where: { id: input.opportunityId },
    select: { id: true, accountId: true },
  });
  if (!opp) throw new Error("Opportunity not found");

  const skuSelections = input.lineItems.filter(
    (
      line,
    ): line is typeof line & { catalogSkuId: string; catalogItemId: string } =>
      Boolean(line.catalogSkuId && line.catalogItemId),
  );
  if (
    input.lineItems.some(
      (line) => line.catalogSkuId && !line.catalogItemId,
    )
  ) {
    throw new Error("An exact SKU selection requires its catalog item");
  }
  if (skuSelections.length > 0) {
    const selectionAsOf = new Date();
    const selectedSkus = await prisma.catalogSku.findMany({
      where: {
        id: {
          in: [...new Set(skuSelections.map((line) => line.catalogSkuId))],
        },
        status: "active",
        effectiveFrom: { lte: selectionAsOf },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gt: selectionAsOf } },
        ],
      },
      select: { id: true, catalogItemId: true },
    });
    const skuCatalogItems = new Map(
      selectedSkus.map((sku) => [sku.id, sku.catalogItemId]),
    );
    if (
      skuSelections.some(
        (line) =>
          skuCatalogItems.get(line.catalogSkuId) !== line.catalogItemId,
      )
    ) {
      throw new Error(
        "Every selected SKU must belong to its quote-line catalog item",
      );
    }
  }

  const quoteNumber = await nextQuoteNumber();
  const discountType = input.discountType || "percentage";
  const discountValue = input.discountValue ?? 0;

  // Calculate totals
  const lines = input.lineItems.map((li, i) => {
    const dp = li.discountPercent ?? 0;
    const tp = li.taxPercent ?? 0;
    const lineTotal = calcLineTotal(li.unitPrice, li.quantity, dp);
    return { ...li, discountPercent: dp, taxPercent: tp, lineTotal, sortOrder: li.sortOrder ?? i };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  const headerDiscount =
    discountType === "percentage"
      ? subtotal * (discountValue / 100)
      : discountValue;

  const taxAmount = lines.reduce(
    (sum, l) => sum + l.lineTotal * (l.taxPercent / 100),
    0,
  );

  const totalAmount = subtotal - headerDiscount + taxAmount;

  const quote = await prisma.$transaction(async (tx) => {
    const created = await tx.quote.create({
      data: {
        quoteId: `QUO-${crypto.randomUUID()}`,
        quoteNumber,
        version: 1,
        status: "draft",
        opportunityId: input.opportunityId,
        accountId: opp.accountId,
        validFrom: new Date(),
        validUntil: new Date(input.validUntil),
        subtotal,
        discountType,
        discountValue,
        taxAmount,
        totalAmount,
        currency: input.currency || "USD",
        terms: input.terms?.trim() || null,
        notes: input.notes?.trim() || null,
        createdById: input.userId || null,
        lineItems: {
          create: lines.map((l) => ({
            productId: l.productId || null,
            catalogItemId: l.catalogItemId || null,
            catalogSkuId: l.catalogSkuId || null,
            configurationSnapshot: l.configurationSnapshot ?? undefined,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            taxPercent: l.taxPercent,
            lineTotal: l.lineTotal,
            sortOrder: l.sortOrder,
          })),
        },
      },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        opportunity: { select: { id: true, opportunityId: true, title: true } },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });
    return created;
  });

  await logSystemActivity(`Quote ${quoteNumber} created (${quote.currency} ${totalAmount.toFixed(2)})`, {
    type: "quote_event",
    accountId: quote.accountId,
    opportunityId: quote.opportunityId,
  });

  return quote;
}

export async function reviseQuote(quoteId: string, userId?: string) {
  const current = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!current) throw new Error("Quote not found");
  if (current.status === "accepted") throw new Error("Cannot revise an accepted quote");

  const quoteNumber = await nextQuoteNumber();

  const revised = await prisma.$transaction(async (tx) => {
    // Supersede current
    await tx.quote.update({
      where: { id: quoteId },
      data: { status: "superseded" },
    });

    // Create new version
    const newQuote = await tx.quote.create({
      data: {
        quoteId: `QUO-${crypto.randomUUID()}`,
        quoteNumber,
        version: current.version + 1,
        previousId: current.id,
        status: "draft",
        opportunityId: current.opportunityId,
        accountId: current.accountId,
        validFrom: new Date(),
        validUntil: current.validUntil,
        subtotal: current.subtotal,
        discountType: current.discountType,
        discountValue: current.discountValue,
        taxAmount: current.taxAmount,
        totalAmount: current.totalAmount,
        currency: current.currency,
        terms: current.terms,
        notes: current.notes,
        createdById: userId || null,
        lineItems: {
          create: current.lineItems.map((li) => ({
            productId: li.productId,
            catalogItemId: li.catalogItemId,
            catalogSkuId: li.catalogSkuId,
            configurationSnapshot: li.configurationSnapshot ?? undefined,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountPercent: li.discountPercent,
            taxPercent: li.taxPercent,
            lineTotal: li.lineTotal,
            sortOrder: li.sortOrder,
          })),
        },
      },
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        opportunity: { select: { id: true, opportunityId: true, title: true } },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });
    return newQuote;
  });

  await logSystemActivity(`Quote revised: ${current.quoteNumber} → ${revised.quoteNumber} (v${revised.version})`, {
    type: "quote_event",
    accountId: revised.accountId,
    opportunityId: revised.opportunityId,
  });

  return revised;
}

export async function sendQuote(quoteId: string, userId?: string) {
  // Mint the public accept-link token on first send (mirrors sendInvoice's
  // payToken): possession authorizes the customer to view + accept the quote.
  const existing = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { acceptToken: true },
  });
  const acceptToken = existing?.acceptToken ?? crypto.randomBytes(24).toString("base64url");
  const quote = await prisma.quote.update({
    where: { id: quoteId },
    data: { status: "sent", sentAt: new Date(), acceptToken },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      account: { select: { id: true, accountId: true, name: true } },
    },
  });

  await logSystemActivity(`Quote ${quote.quoteNumber} sent to ${quote.account.name}`, {
    type: "quote_event",
    accountId: quote.accountId,
    opportunityId: quote.opportunityId,
  });

  return quote;
}

export async function acceptQuote(quoteId: string, userId?: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { opportunity: true },
  });
  if (!quote) throw new Error("Quote not found");
  if (quote.status === "accepted") throw new Error("Quote already accepted");

  const orderRef = await nextSalesOrderRef();

  const result = await prisma.$transaction(async (tx) => {
    // Accept quote
    const accepted = await tx.quote.update({
      where: { id: quoteId },
      data: { status: "accepted", acceptedAt: new Date() },
      include: {
        lineItems: {
          orderBy: { sortOrder: "asc" },
          include: {
            catalogItem: {
              include: {
                offering: { include: { product: true } },
                bundleComponents: {
                  where: { effectiveTo: null },
                  orderBy: { sortOrder: "asc" },
                  include: { componentCatalogItem: true },
                },
              },
            },
            catalogSku: { include: { configuration: true } },
          },
        },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });

    // Create sales order
    const order = await tx.salesOrder.create({
      data: {
        orderRef,
        status: "confirmed",
        quoteId: accepted.id,
        accountId: accepted.accountId,
        totalAmount: accepted.totalAmount,
        currency: accepted.currency,
      },
    });

    const observedAt = new Date();
    for (const line of accepted.lineItems) {
      const catalogItem = line.catalogItem;
      if (!catalogItem) continue;
      const unitPrice = line.unitPrice.toNumber();
      const discountPercent = line.discountPercent.toNumber();
      const taxPercent = line.taxPercent.toNumber();
      const totalAmount = line.lineTotal.toNumber();
      const configuration = line.catalogSku?.configuration ?? null;
      const pricingSnapshot = {
        version: 1,
        source: "accepted-quote-line",
        quoteNumber: accepted.quoteNumber,
        unitPrice,
        quantity: line.quantity,
        discountPercent,
        taxPercent,
        totalAmount,
        currency: accepted.currency,
      };
      const draft = createProductSoldDraft({
        selection: {
          organizationId: catalogItem.organizationId,
          providerOrganizationId:
            catalogItem.offering.providerOrganizationId,
          product: catalogItem.offering.product,
          offering: catalogItem.offering,
          catalogItem,
          catalogSku: line.catalogSku,
          configuration,
          priceListEntryId: null,
          promotionId: null,
          quantity: line.quantity,
          unitPrice,
          discountAmount:
            unitPrice * line.quantity * (discountPercent / 100),
          taxAmount: totalAmount * (taxPercent / 100),
          totalAmount,
          currency: accepted.currency,
          purchasedAt: observedAt,
          configurationSnapshot: line.configurationSnapshot,
          pricingSnapshot,
        },
        evidence: {
          kind: "quote-line",
          sourceId: line.id,
          sourceRef: `${accepted.quoteNumber}:${line.sortOrder + 1}`,
          observedAt,
          snapshot: {
            quoteId: accepted.id,
            quoteNumber: accepted.quoteNumber,
            description: line.description,
            configurationSnapshot: line.configurationSnapshot,
          },
        },
      });
      const materialized = await materializeProductSold({
        db: tx as never,
        draft,
      });
      await persistProductSoldComponentAllocations({
        db: tx as never,
        organizationId: catalogItem.organizationId,
        productSoldId: materialized.id,
        packageRevenue: totalAmount,
        components: snapshotProductSoldComponents(
          catalogItem.bundleComponents ?? [],
        ),
      });
      await appendProductSoldEvidence({
        db: tx as never,
        organizationId: catalogItem.organizationId,
        productSoldId: materialized.id,
        kind: "sales-order",
        sourceId: order.id,
        sourceRef: order.orderRef,
        observedAt,
        snapshot: {
          orderRef: order.orderRef,
          status: order.status,
          accountId: accepted.accountId,
        },
      });
      const parties = createProductSoldPartyLinks({
        evidenceId: materialized.evidenceId,
        observedAt,
        account: accepted.account,
        contact: null,
        subscriber: null,
        evidenceSnapshot: {},
      });
      await persistProductSoldPartyLinks({
        db: tx as never,
        organizationId: catalogItem.organizationId,
        productSoldId: materialized.id,
        links: parties,
      });
    }

    // Close opportunity as won
    await tx.opportunity.update({
      where: { id: accepted.opportunityId },
      data: {
        stage: "closed_won",
        probability: 100,
        actualClose: new Date(),
        stageChangedAt: new Date(),
        isDormant: false,
      },
    });

    return { quote: accepted, salesOrder: order };
  });

  await logSystemActivity(
    `Quote ${result.quote.quoteNumber} accepted → Sales Order ${result.salesOrder.orderRef} created`,
    {
      type: "quote_event",
      accountId: result.quote.accountId,
      opportunityId: result.quote.opportunityId,
    },
  );

  await logSystemActivity("Opportunity closed WON (quote accepted)", {
    type: "status_change",
    accountId: result.quote.accountId,
    opportunityId: result.quote.opportunityId,
  });

  // Auto-generate invoice from sales order
  try {
    await generateInvoiceFromSalesOrder(result.salesOrder.id);
  } catch (err) {
    console.error("Auto-invoice generation failed for SalesOrder", result.salesOrder.orderRef, err);
  }

  return result;
}

export async function rejectQuote(
  quoteId: string,
  opts: { reason?: string; userId?: string } = {},
) {
  const quote = await prisma.quote.update({
    where: { id: quoteId },
    data: { status: "rejected", rejectedAt: new Date() },
    include: {
      account: { select: { id: true, accountId: true, name: true } },
    },
  });

  await logSystemActivity(
    `Quote ${quote.quoteNumber} rejected${opts.reason ? `: ${opts.reason}` : ""}`,
    {
      type: "quote_event",
      accountId: quote.accountId,
      opportunityId: quote.opportunityId,
    },
  );

  return quote;
}
