"use server";

import * as crypto from "crypto";
import { prisma, syncDigitalProduct } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireManagePortfolio(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_portfolio")
  ) {
    throw new Error("Unauthorized");
  }
}

// ─── Input type ───────────────────────────────────────────────────────────────

export type ProductInput = {
  name: string;
  lifecycleStage: string;   // plan | design | build | production | retirement
  lifecycleStatus: string;  // draft | active | inactive
  portfolioId?: string | null;
  taxonomyNodeId?: string | null;
};

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createDigitalProduct(input: ProductInput): Promise<void> {
  await requireManagePortfolio();

  const dp = await prisma.digitalProduct.create({
    data: {
      productId:      `DP-${crypto.randomUUID()}`,
      name:           input.name.trim(),
      lifecycleStage: input.lifecycleStage,
      lifecycleStatus:input.lifecycleStatus,
      portfolioId:    input.portfolioId  ?? null,
      taxonomyNodeId: input.taxonomyNodeId ?? null,
    },
    include: { portfolio: true },
  });

  // Project to Neo4j — fire and forget, never blocks the response
  syncDigitalProduct({
    productId:       dp.productId,
    name:            dp.name,
    lifecycleStage:  dp.lifecycleStage,
    lifecycleStatus: dp.lifecycleStatus,
    portfolioSlug:   dp.portfolio?.slug ?? null,
    taxonomyNodeId:  dp.taxonomyNodeId ?? null,
  }).catch((err) => console.error("[neo4j] syncDigitalProduct failed:", err));

  revalidatePath("/portfolio");
  revalidatePath("/inventory");
}

export async function updateDigitalProduct(id: string, input: ProductInput): Promise<void> {
  await requireManagePortfolio();

  const dp = await prisma.digitalProduct.update({
    where: { id },
    data: {
      name:           input.name.trim(),
      lifecycleStage: input.lifecycleStage,
      lifecycleStatus:input.lifecycleStatus,
      portfolioId:    input.portfolioId  ?? null,
      taxonomyNodeId: input.taxonomyNodeId ?? null,
    },
    include: { portfolio: true },
  });

  syncDigitalProduct({
    productId:       dp.productId,
    name:            dp.name,
    lifecycleStage:  dp.lifecycleStage,
    lifecycleStatus: dp.lifecycleStatus,
    portfolioSlug:   dp.portfolio?.slug ?? null,
    taxonomyNodeId:  dp.taxonomyNodeId ?? null,
  }).catch((err) => console.error("[neo4j] syncDigitalProduct failed:", err));

  revalidatePath("/portfolio");
  revalidatePath("/inventory");
}

export async function deleteDigitalProduct(id: string): Promise<void> {
  await requireManagePortfolio();

  const dp = await prisma.digitalProduct.delete({ where: { id } });

  // Remove from graph projection
  import("@dpf/db").then(({ runCypher }) =>
    runCypher(
      `MATCH (dp:DigitalProduct {productId: $productId}) DETACH DELETE dp`,
      { productId: dp.productId },
    ).catch((err) => console.error("[neo4j] delete DigitalProduct failed:", err))
  );

  revalidatePath("/portfolio");
  revalidatePath("/inventory");
}
