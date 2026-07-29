import { newId } from "../shared/new-id";
import {
  allocateBundleRevenue,
  BUNDLE_ALLOCATION_MODES,
  type BundleAllocationMode,
} from "./catalog-builder";
import {
  evidenceSourceData,
  frozenClone,
  transitionProductSold,
  type ProductSoldEvidenceKind,
  type ProductSoldStatus,
} from "./product-sold";

type ProductSoldComponentAllocationWriteClient = {
  productSoldComponentAllocation: {
    upsert(input: unknown): Promise<{ id: string }>;
  };
};

type ProductSoldComponentInput = {
  componentCatalogItemId: string;
  quantity: number;
  allocationMode: string;
  allocationPercent: number | null;
  componentSnapshot: Record<string, unknown>;
};

type DecimalValue = { toNumber(): number };

export function snapshotProductSoldComponents(
  components: Array<{
    componentId: string;
    componentCatalogItemId: string;
    quantity: DecimalValue;
    eligibility: string;
    allocationMode: string;
    allocationPercent: DecimalValue | null;
    componentCatalogItem: {
      catalogItemId: string;
      name: string;
    };
  }>,
): ProductSoldComponentInput[] {
  return components.map((component) => ({
    componentCatalogItemId: component.componentCatalogItemId,
    quantity: component.quantity.toNumber(),
    allocationMode: component.allocationMode,
    allocationPercent: component.allocationPercent?.toNumber() ?? null,
    componentSnapshot: frozenClone({
      componentId: component.componentId,
      catalogItemId: component.componentCatalogItem.catalogItemId,
      name: component.componentCatalogItem.name,
      eligibility: component.eligibility,
    }),
  }));
}

export async function persistProductSoldComponentAllocations(input: {
  db: ProductSoldComponentAllocationWriteClient;
  organizationId: string;
  productSoldId: string;
  packageRevenue: number;
  components: ProductSoldComponentInput[];
}): Promise<void> {
  if (input.components.length === 0) return;
  const components = input.components.map((component) => {
    if (
      !BUNDLE_ALLOCATION_MODES.includes(
        component.allocationMode as BundleAllocationMode,
      )
    ) {
      throw new Error(
        `Unsupported bundle allocation mode: ${component.allocationMode}`,
      );
    }
    return {
      ...component,
      allocationMode: component.allocationMode as BundleAllocationMode,
    };
  });
  const attribution = allocateBundleRevenue({
    packageRevenue: input.packageRevenue,
    components: components.map((component) => ({
      catalogItemId: component.componentCatalogItemId,
      quantity: component.quantity,
      allocationMode: component.allocationMode,
      allocationPercent: component.allocationPercent,
    })),
  });
  const amountByComponent = new Map(
    attribution.componentAttribution.map((component) => [
      component.catalogItemId,
      component.allocatedRevenue,
    ]),
  );
  for (const component of components) {
    const allocatedAmount =
      component.allocationMode === "unallocated"
        ? null
        : (amountByComponent.get(component.componentCatalogItemId) ?? 0);
    await input.db.productSoldComponentAllocation.upsert({
      where: {
        productSoldId_componentCatalogItemId: {
          productSoldId: input.productSoldId,
          componentCatalogItemId: component.componentCatalogItemId,
        },
      },
      create: {
        allocationId: `ALLOCATION-${newId(8).toUpperCase()}`,
        organizationId: input.organizationId,
        productSoldId: input.productSoldId,
        componentCatalogItemId: component.componentCatalogItemId,
        quantity: component.quantity,
        allocationMode: component.allocationMode,
        allocatedAmount,
        allocationPercent: component.allocationPercent,
        reportingTreatment: "non-additive",
        componentSnapshot: frozenClone(component.componentSnapshot),
      },
      update: {
        quantity: component.quantity,
        allocationMode: component.allocationMode,
        allocatedAmount,
        allocationPercent: component.allocationPercent,
        reportingTreatment: "non-additive",
        componentSnapshot: frozenClone(component.componentSnapshot),
      },
      select: { id: true },
    });
  }
}

type ProductSoldLifecycleWriteClient = {
  productSoldEvidence: {
    findMany(input: unknown): Promise<
      Array<{
        id: string;
        productSold: {
          id: string;
          status: ProductSoldStatus;
          commercialSnapshot: Readonly<unknown>;
          pricingSnapshot: Readonly<unknown>;
          cancelledAt: Date | null;
          refundedAt: Date | null;
        };
      }>
    >;
  };
  productSold: {
    update(input: unknown): Promise<unknown>;
  };
  productFulfillmentInstance: {
    updateMany(input: unknown): Promise<unknown>;
  };
};

export async function transitionProductSoldByEvidence(input: {
  db: ProductSoldLifecycleWriteClient;
  kind: ProductSoldEvidenceKind;
  sourceId: string;
  to: ProductSoldStatus;
  occurredAt: Date;
}): Promise<void> {
  const evidenceRows = await input.db.productSoldEvidence.findMany({
    where: evidenceSourceData(input.kind, input.sourceId),
    select: {
      id: true,
      productSold: {
        select: {
          id: true,
          status: true,
          commercialSnapshot: true,
          pricingSnapshot: true,
          cancelledAt: true,
          refundedAt: true,
        },
      },
    },
  });
  for (const evidence of evidenceRows) {
    if (evidence.productSold.status === input.to) continue;
    const transitioned = transitionProductSold(evidence.productSold, {
      to: input.to,
      occurredAt: input.occurredAt,
    });
    await input.db.productSold.update({
      where: { id: transitioned.id },
      data: {
        status: transitioned.status,
        cancelledAt: transitioned.cancelledAt,
        refundedAt: transitioned.refundedAt,
      },
    });
    await input.db.productFulfillmentInstance.updateMany({
      where: { evidenceId: evidence.id },
      data: {
        status: transitioned.status,
        completedAt:
          transitioned.status === "fulfilled" ? input.occurredAt : null,
        endedAt:
          transitioned.status === "cancelled" ||
          transitioned.status === "refunded"
            ? input.occurredAt
            : null,
      },
    });
  }
}
