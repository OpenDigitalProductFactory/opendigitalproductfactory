"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  ProductManagementAccessError,
  ProductManagementOrganizationNotFoundError,
  loadCurrentProductOperatingContextByKey,
} from "@/lib/product-management/current-product-operating-context.server";
import { ProductOperatingContextNotFoundError } from "@/lib/product-management/product-operating-context-query";
import { createProductIntelligenceWatch } from "@/lib/product-management/product-intelligence-watch";
import { proposeResearch } from "@/lib/wiki/research-proposal";
import { queueProductManagementPlaybookRefreshBestEffort } from "@/lib/product-management/product-management-playbook-refresh";

export type ProductIntelligenceActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

type ProductResearchActionInput = {
  productId: string;
  topic: string;
  query: string;
};

type ProductWatchActionInput = ProductResearchActionInput & {
  schedule: string;
};

function cleanRequired(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function intelligencePath(productId: string): string {
  return `/portfolio/product/${encodeURIComponent(productId)}/direction/intelligence`;
}

async function resolveAuthorizedProduct(productId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Not authenticated" } as const;
  }

  const context = await loadCurrentProductOperatingContextByKey(
    "product",
    productId,
  );
  const product = context.products.find((candidate) => candidate.id === productId);
  if (!product) {
    throw new ProductOperatingContextNotFoundError({
      kind: "product",
      id: productId,
    });
  }
  return { context, product, userId: session.user.id } as const;
}

function actionError(error: unknown): ProductIntelligenceActionResult {
  if (
    error instanceof ProductOperatingContextNotFoundError ||
    error instanceof ProductManagementAccessError ||
    error instanceof ProductManagementOrganizationNotFoundError
  ) {
    return { ok: false, error: "This product is not available." };
  }
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: "The action could not be completed." };
}

export async function proposeProductResearchAction(
  input: ProductResearchActionInput,
): Promise<ProductIntelligenceActionResult> {
  try {
    const authorized = await resolveAuthorizedProduct(input.productId);
    if ("error" in authorized) {
      return { ok: false, error: authorized.error ?? "Not authenticated" };
    }
    const result = await proposeResearch({
      organizationId: authorized.context.provider.id,
      productLineId: authorized.product.productLineId,
      businessProductId: authorized.product.id,
      topic: cleanRequired(input.topic, "Topic"),
      query: cleanRequired(input.query, "Research question"),
      proposedBy: "user",
    });
    if (result.created) {
      await queueProductManagementPlaybookRefreshBestEffort({
        organizationId: authorized.context.provider.id,
        productLineId: authorized.product.productLineId,
        businessProductId: authorized.product.id,
        sourceKind: "research-proposal",
        sourceId: result.proposalId,
        changedAt: new Date(),
      });
    }
    revalidatePath(intelligencePath(input.productId));
    return {
      ok: true,
      message: result.created
        ? "Research proposal created for review."
        : "That research proposal is already awaiting review.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function createProductIntelligenceWatchAction(
  input: ProductWatchActionInput,
): Promise<ProductIntelligenceActionResult> {
  try {
    const authorized = await resolveAuthorizedProduct(input.productId);
    if ("error" in authorized) {
      return { ok: false, error: authorized.error ?? "Not authenticated" };
    }
    const result = await createProductIntelligenceWatch({
      ownerUserId: authorized.userId,
      organizationId: authorized.context.provider.id,
      productLineId: authorized.product.productLineId,
      businessProductId: authorized.product.id,
      title: `${authorized.product.name} intelligence scan`,
      topic: cleanRequired(input.topic, "Topic"),
      query: cleanRequired(input.query, "Research question"),
      schedule: cleanRequired(input.schedule, "Cadence"),
    });
    if (!result.success) {
      return {
        ok: false,
        error: result.error ?? "The recurring scan could not be scheduled.",
      };
    }
    revalidatePath(intelligencePath(input.productId));
    return {
      ok: true,
      message:
        "Recurring scan scheduled. Each run will create a proposal for review.",
    };
  } catch (error) {
    return actionError(error);
  }
}
