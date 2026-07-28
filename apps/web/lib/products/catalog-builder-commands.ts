import type { Prisma, PrismaClient } from "@dpf/db";

import { newId } from "../shared/new-id";
import { slugify } from "../shared/slugify";
import {
  BUNDLE_ALLOCATION_MODES,
  BUNDLE_COMPONENT_ELIGIBILITY,
  CATALOG_CHANNEL_ELIGIBILITY,
  CATALOG_FULFILLMENT_ROUTES,
  CATALOG_PROMOTION_ADJUSTMENT_TYPES,
  currentEffectiveWindowFilter,
  promoteOneOffConfiguration,
  validateBundleComponents,
  validateEffectiveWindow,
  type BundleAllocationMode,
} from "./catalog-builder";

export type CatalogBuilderCommand = Record<string, unknown> & {
  operation?: string;
};

export type CatalogBuilderCommandClient = Pick<
  PrismaClient,
  | "$transaction"
  | "catalogBundleComponent"
  | "catalogChannelEligibility"
  | "catalogItem"
  | "catalogPriceList"
  | "catalogPriceListEntry"
  | "catalogPromotion"
  | "catalogPromotionItem"
  | "catalogSku"
  | "productConfiguration"
  | "quoteLineItem"
>;

export type CatalogBuilderCommandItem = {
  id: string;
  organizationId: string;
  priceCurrency: string;
};

export async function executeCatalogBuilderCommand(input: {
  db: CatalogBuilderCommandClient;
  command: CatalogBuilderCommand;
  catalogItem: CatalogBuilderCommandItem;
  now?: Date;
}): Promise<string> {
  const { command, catalogItem, db } = input;
  const now = input.now ?? new Date();

  switch (command.operation) {
    case "set-fulfillment-route": {
      const route =
        typeof command.fulfillmentRoute === "string"
          ? command.fulfillmentRoute
          : null;
      if (
        route &&
        !CATALOG_FULFILLMENT_ROUTES.includes(
          route as (typeof CATALOG_FULFILLMENT_ROUTES)[number],
        )
      ) {
        throw new Error("Choose a supported purchase route");
      }
      await db.catalogItem.update({
        where: { id: catalogItem.id },
        data: {
          fulfillmentRoute: route,
          ...(route == null ? {} : { quoteRequired: route === "quote" }),
        },
      });
      return "Purchase route saved";
    }

    case "replace-bundle": {
      const rawComponents = Array.isArray(command.components)
        ? command.components
        : [];
      const components = rawComponents.map((value) => {
        const component = asRecord(value);
        const allocationMode =
          typeof component.allocationMode === "string"
            ? component.allocationMode
            : "unallocated";
        if (
          !BUNDLE_ALLOCATION_MODES.includes(
            allocationMode as BundleAllocationMode,
          )
        ) {
          throw new Error("Choose a supported attribution method");
        }
        const eligibility =
          typeof component.eligibility === "string"
            ? component.eligibility
            : "standalone-and-bundle";
        if (
          !BUNDLE_COMPONENT_ELIGIBILITY.includes(
            eligibility as (typeof BUNDLE_COMPONENT_ELIGIBILITY)[number],
          )
        ) {
          throw new Error("Choose a supported package eligibility");
        }
        return {
          catalogItemId: requiredString(
            component.catalogItemId,
            "Choose an item to include",
          ),
          quantity: positiveNumber(component.quantity, "Quantity"),
          eligibility,
          allocationMode: allocationMode as BundleAllocationMode,
          allocationPercent:
            component.allocationPercent == null
              ? null
              : nonNegativeNumber(
                  component.allocationPercent,
                  "Revenue attribution",
                ),
        };
      });
      const validation = validateBundleComponents({
        parentCatalogItemId: catalogItem.id,
        components,
      });
      if (!validation.ok) throw new Error(validation.error);

      const linkedItems = await db.catalogItem.findMany({
        where: {
          id: { in: components.map((component) => component.catalogItemId) },
          organizationId: catalogItem.organizationId,
          status: "active",
          ...currentEffectiveWindowFilter(now),
        },
        select: { id: true },
      });
      if (linkedItems.length !== components.length) {
        throw new Error(
          "Every package component must be an active item from this organization",
        );
      }

      await db.$transaction(async (tx) => {
        await tx.catalogBundleComponent.deleteMany({
          where: { parentCatalogItemId: catalogItem.id },
        });
        if (components.length > 0) {
          await tx.catalogBundleComponent.createMany({
            data: components.map((component, index) => ({
              componentId: `COMP-${newId(8).toUpperCase()}`,
              organizationId: catalogItem.organizationId,
              parentCatalogItemId: catalogItem.id,
              componentCatalogItemId: component.catalogItemId,
              quantity: component.quantity,
              eligibility: component.eligibility,
              allocationMode: component.allocationMode,
              allocationPercent: component.allocationPercent,
              sortOrder: index,
              sourceKind: "catalog-builder",
            })),
          });
        }
      });
      return "Package contents saved";
    }

    case "add-price-list-entry": {
      const name = requiredString(command.name, "Price list name is required");
      const priceAmount = nonNegativeNumber(command.priceAmount, "Amount");
      const window = readEffectiveWindow(command, now);
      const key = slugify(name) || `prices-${newId(6).toLowerCase()}`;

      await db.$transaction(async (tx) => {
        const priceList = await tx.catalogPriceList.upsert({
          where: {
            organizationId_key: {
              organizationId: catalogItem.organizationId,
              key,
            },
          },
          create: {
            priceListId: `PRICE-${newId(8).toUpperCase()}`,
            organizationId: catalogItem.organizationId,
            key,
            name,
            currency: catalogItem.priceCurrency,
            status: "active",
            effectiveFrom: now,
            effectiveTo: null,
            sourceKind: "catalog-builder",
          },
          update: {
            name,
            currency: catalogItem.priceCurrency,
            status: "active",
            effectiveTo: null,
          },
          select: { id: true },
        });
        await tx.catalogPriceListEntry.create({
          data: {
            entryId: `PRICEENTRY-${newId(8).toUpperCase()}`,
            organizationId: catalogItem.organizationId,
            priceListId: priceList.id,
            catalogItemId: catalogItem.id,
            priceAmount,
            effectiveFrom: window.effectiveFrom,
            effectiveTo: window.effectiveTo,
            sourceKind: "catalog-builder",
          },
        });
      });
      return "Dated price added";
    }

    case "add-promotion": {
      const name = requiredString(command.name, "Offer name is required");
      const adjustmentType = requiredString(
        command.adjustmentType,
        "Price change is required",
      );
      if (
        !CATALOG_PROMOTION_ADJUSTMENT_TYPES.includes(
          adjustmentType as (typeof CATALOG_PROMOTION_ADJUSTMENT_TYPES)[number],
        )
      ) {
        throw new Error("Choose a supported price change");
      }
      const adjustmentValue = nonNegativeNumber(
        command.adjustmentValue,
        "Offer value",
      );
      const window = readEffectiveWindow(command, now);
      const key = `${
        slugify(name) || `offer-${newId(6).toLowerCase()}`
      }-${window.effectiveFrom.toISOString().slice(0, 10)}`;

      await db.$transaction(async (tx) => {
        const promotion = await tx.catalogPromotion.upsert({
          where: {
            organizationId_key: {
              organizationId: catalogItem.organizationId,
              key,
            },
          },
          create: {
            promotionId: `PROMO-${newId(8).toUpperCase()}`,
            organizationId: catalogItem.organizationId,
            key,
            name,
            status: "active",
            adjustmentType,
            adjustmentValue,
            effectiveFrom: window.effectiveFrom,
            effectiveTo: window.effectiveTo,
            sourceKind: "catalog-builder",
          },
          update: {
            name,
            status: "active",
            adjustmentType,
            adjustmentValue,
            effectiveFrom: window.effectiveFrom,
            effectiveTo: window.effectiveTo,
          },
          select: { id: true },
        });
        await tx.catalogPromotionItem.deleteMany({
          where: {
            promotionId: promotion.id,
            catalogItemId: catalogItem.id,
            priceListId: null,
          },
        });
        await tx.catalogPromotionItem.create({
          data: {
            promotionItemId: `PROMOITEM-${newId(8).toUpperCase()}`,
            organizationId: catalogItem.organizationId,
            promotionId: promotion.id,
            catalogItemId: catalogItem.id,
          },
        });
      });
      return "Seasonal offer added";
    }

    case "set-channel-eligibility": {
      const channelKey = requiredString(
        command.channelKey,
        "Sales channel is required",
      );
      const eligibility = requiredString(
        command.eligibility,
        "Availability is required",
      );
      if (
        !CATALOG_CHANNEL_ELIGIBILITY.includes(
          eligibility as (typeof CATALOG_CHANNEL_ELIGIBILITY)[number],
        )
      ) {
        throw new Error("Choose a supported availability");
      }
      await db.$transaction(async (tx) => {
        await tx.catalogChannelEligibility.updateMany({
          where: {
            catalogItemId: catalogItem.id,
            channelKey,
            effectiveTo: null,
          },
          data: { effectiveTo: now },
        });
        await tx.catalogChannelEligibility.create({
          data: {
            eligibilityId: `CHANNEL-${newId(8).toUpperCase()}`,
            organizationId: catalogItem.organizationId,
            catalogItemId: catalogItem.id,
            channelKey,
            eligibility,
            effectiveFrom: now,
            sourceKind: "catalog-builder",
          },
        });
      });
      return "Channel availability saved";
    }

    case "publish-configuration": {
      const name = requiredString(command.name, "Option name is required");
      const skuCode = requiredString(command.skuCode, "SKU code is required");
      const specification = asRecord(command.specification);
      if (Object.keys(specification).length === 0) {
        throw new Error("Add at least one option as name=value");
      }
      const key = slugify(name) || `option-${newId(6).toLowerCase()}`;
      await db.$transaction(async (tx) => {
        const existingSku = await tx.catalogSku.findUnique({
          where: {
            organizationId_code: {
              organizationId: catalogItem.organizationId,
              code: skuCode,
            },
          },
          select: { id: true, catalogItemId: true },
        });
        if (
          existingSku &&
          existingSku.catalogItemId !== catalogItem.id
        ) {
          throw new Error(
            "SKU code is already used by another catalog item",
          );
        }
        const configuration = await tx.productConfiguration.upsert({
          where: {
            catalogItemId_key: {
              catalogItemId: catalogItem.id,
              key,
            },
          },
          create: {
            configurationId: `CONFIG-${newId(8).toUpperCase()}`,
            organizationId: catalogItem.organizationId,
            catalogItemId: catalogItem.id,
            key,
            name,
            kind: "reusable",
            status: "active",
            specification: specification as Prisma.InputJsonObject,
            sourceKind: "catalog-builder",
          },
          update: {
            name,
            status: "active",
            specification: specification as Prisma.InputJsonObject,
            effectiveTo: null,
          },
          select: { id: true },
        });
        await tx.catalogSku.upsert({
          where: {
            organizationId_code: {
              organizationId: catalogItem.organizationId,
              code: skuCode,
            },
          },
          create: {
            skuId: `SKU-${newId(8).toUpperCase()}`,
            organizationId: catalogItem.organizationId,
            catalogItemId: catalogItem.id,
            configurationId: configuration.id,
            code: skuCode,
            name,
            status: "active",
            sourceKind: "catalog-builder",
          },
          update: {
            catalogItemId: catalogItem.id,
            configurationId: configuration.id,
            name,
            status: "active",
            effectiveTo: null,
          },
        });
      });
      return "Reusable standard option published";
    }

    case "promote-quote-configuration": {
      const quoteLineItemId = requiredString(
        command.quoteLineItemId,
        "Quote line reference is required",
      );
      const name = requiredString(command.name, "Option name is required");
      const skuCode = requiredString(command.skuCode, "SKU code is required");
      await db.$transaction(async (tx) => {
        await promoteOneOffConfiguration({
          db: tx,
          organizationId: catalogItem.organizationId,
          quoteLineItemId,
          key: slugify(name) || `option-${newId(6).toLowerCase()}`,
          name,
          skuCode,
          promotedAt: now,
        });
      });
      return "Quoted option promoted to the reusable catalog";
    }

    default:
      throw new Error("Choose a supported Catalog Builder action");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function nonNegativeNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be zero or greater`);
  }
  return number;
}

function positiveNumber(value: unknown, label: string): number {
  const number = nonNegativeNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be greater than zero`);
  return number;
}

function readEffectiveWindow(
  command: CatalogBuilderCommand,
  now: Date,
): {
  effectiveFrom: Date;
  effectiveTo: Date | null;
} {
  const effectiveFrom =
    typeof command.effectiveFrom === "string" && command.effectiveFrom
      ? new Date(`${command.effectiveFrom}T00:00:00.000Z`)
      : now;
  const effectiveTo =
    typeof command.effectiveTo === "string" && command.effectiveTo
      ? new Date(`${command.effectiveTo}T00:00:00.000Z`)
      : null;
  if (
    Number.isNaN(effectiveFrom.getTime()) ||
    (effectiveTo && Number.isNaN(effectiveTo.getTime()))
  ) {
    throw new Error("Choose valid start and end dates");
  }
  const validation = validateEffectiveWindow({
    effectiveFrom,
    effectiveTo,
  });
  if (!validation.ok) throw new Error(validation.error);
  return { effectiveFrom, effectiveTo };
}
