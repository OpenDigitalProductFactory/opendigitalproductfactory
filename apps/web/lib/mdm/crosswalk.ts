/**
 * MasterDataSourceRef crosswalk writer (BI-A4B73F87 multi-source pilot).
 *
 * The crosswalk table shipped with the MDM foundation but only one source
 * ever wrote to it. This helper is the single door: every identity flow that
 * creates or matches a customer account registers WHERE the record came from
 * (portal UI, coworker tool, storefront order, storefront sign-up, social
 * auth), giving each account source lineage and making the "same customer
 * from a second system" case land as a crosswalk link — not a duplicate row.
 * Best-effort: lineage must never fail the write it describes.
 */
import { prisma } from "@dpf/db";

export type CustomerSourceSystem =
  | "portal-ui"
  | "coworker-tool"
  | "storefront-order"
  | "storefront-signup"
  | "social-auth";

export async function registerCustomerAccountSource(args: {
  accountId: string;
  sourceSystem: CustomerSourceSystem;
  /** Stable id in the source system (order email, provider account id, …). */
  sourceEntityId: string;
  sourceEntityType?: string;
}): Promise<void> {
  const now = new Date();
  try {
    await prisma.masterDataSourceRef.upsert({
      where: {
        domain_sourceSystem_sourceEntityId: {
          domain: "customer-account",
          sourceSystem: args.sourceSystem,
          sourceEntityId: args.sourceEntityId,
        },
      },
      create: {
        domain: "customer-account",
        canonicalId: args.accountId,
        customerAccountId: args.accountId,
        sourceSystem: args.sourceSystem,
        sourceEntityType: args.sourceEntityType ?? "customer-account",
        sourceEntityId: args.sourceEntityId,
        observedAt: now,
        lastSeenAt: now,
        trustTier: "internal",
      },
      update: { lastSeenAt: now },
    });
  } catch (err) {
    console.error("[mdm-crosswalk] failed to register source ref", err);
  }
}
