import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";

import { evaluateTechnologyLifecycle } from "./lifecycle-evaluation";

type CustomerEstateSummary = {
  siteCount: number;
  activeSiteCount: number;
  managedItemCount: number;
  lifecycleAttentionCount: number;
  recurringLicensedItemCount: number;
  commercialCount: number;
  openSourceCount: number;
  hybridCount: number;
  topAttentionItems: Array<{
    id: string;
    customerCiId: string;
    name: string;
    ciType: string;
    lifecycleStatus: string;
    supportStatus: string;
    recommendedAction: string;
    attentionLevel: string;
  }>;
};

const ATTENTION_ORDER: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const CUSTOMER_CONFIGURATION_ITEM_SELECT: Prisma.CustomerConfigurationItemSelect = {
  id: true,
  customerCiId: true,
  name: true,
  ciType: true,
  status: true,
  siteId: true,
  technologySourceType: true,
  supportModel: true,
  observedVersion: true,
  normalizedVersion: true,
  warrantyEndAt: true,
  endOfSupportAt: true,
  endOfLifeAt: true,
  renewalDate: true,
  billingCadence: true,
  customerChargeModel: true,
  licenseQuantity: true,
  unitCost: true,
  customerUnitPrice: true,
};

export async function loadCustomerEstateSummary(
  accountId: string,
  asOf: Date = new Date(),
): Promise<CustomerEstateSummary> {
  const [sites, configurationItems] = await Promise.all([
    prisma.customerSite.findMany({
      where: { accountId },
      select: {
        id: true,
        name: true,
        status: true,
      },
    }),
    prisma.customerConfigurationItem.findMany({
      where: { accountId, status: { not: "archived" } },
      select: CUSTOMER_CONFIGURATION_ITEM_SELECT,
      orderBy: { name: "asc" },
    }),
  ]);

  const evaluatedItems = configurationItems.map((item) => ({
    ...item,
    lifecycle: evaluateTechnologyLifecycle(
      {
        name: item.name,
        ciType: item.ciType,
        technologySourceType: item.technologySourceType as "commercial" | "open_source" | "hybrid" | null,
        supportModel: item.supportModel as
          | "vendor_contract"
          | "subscription"
          | "community"
          | "lts"
          | "partner"
          | "unknown"
          | null,
        observedVersion: item.observedVersion,
        normalizedVersion: item.normalizedVersion,
        warrantyEndAt: item.warrantyEndAt,
        endOfSupportAt: item.endOfSupportAt,
        endOfLifeAt: item.endOfLifeAt,
        renewalDate: item.renewalDate,
        billingCadence: item.billingCadence,
        customerChargeModel: item.customerChargeModel,
        licenseQuantity: item.licenseQuantity ? Number(item.licenseQuantity) : null,
        unitCost: item.unitCost ? Number(item.unitCost) : null,
        customerUnitPrice: item.customerUnitPrice ? Number(item.customerUnitPrice) : null,
      },
      asOf,
    ),
  }));

  const attentionItems = evaluatedItems
    .filter((item) => item.lifecycle.attentionLevel !== "low")
    .sort((left, right) => {
      const byAttention =
        ATTENTION_ORDER[right.lifecycle.attentionLevel] - ATTENTION_ORDER[left.lifecycle.attentionLevel];
      if (byAttention !== 0) return byAttention;
      return left.name.localeCompare(right.name);
    });

  return {
    siteCount: sites.length,
    activeSiteCount: sites.filter((site) => site.status === "active").length,
    managedItemCount: configurationItems.length,
    lifecycleAttentionCount: attentionItems.length,
    recurringLicensedItemCount: evaluatedItems.filter((item) => item.lifecycle.licensingReviewRequired).length,
    commercialCount: configurationItems.filter((item) => item.technologySourceType === "commercial").length,
    openSourceCount: configurationItems.filter((item) => item.technologySourceType === "open_source").length,
    hybridCount: configurationItems.filter((item) => item.technologySourceType === "hybrid").length,
    topAttentionItems: attentionItems.slice(0, 5).map((item) => ({
      id: item.id,
      customerCiId: item.customerCiId,
      name: item.name,
      ciType: item.ciType,
      lifecycleStatus: item.lifecycle.lifecycleStatus,
      supportStatus: item.lifecycle.supportStatus,
      recommendedAction: item.lifecycle.recommendedAction,
      attentionLevel: item.lifecycle.attentionLevel,
    })),
  };
}
