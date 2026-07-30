import { prisma } from "@dpf/db";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import {
  executeCatalogBuilderCommand,
  type CatalogBuilderCommand,
} from "@/lib/products/catalog-builder-commands";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ catalogItemId: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const { catalogItemId } = await params;
  const config = await prisma.storefrontConfig.findFirst({
    select: { organizationId: true },
  });
  if (!config) {
    return apiErrorResponse(
      "NOT_FOUND",
      "No storefront configured",
      404,
    );
  }

  const catalogItem = await prisma.catalogItem.findFirst({
    where: {
      id: catalogItemId,
      organizationId: config.organizationId,
    },
    select: {
      id: true,
      organizationId: true,
      priceCurrency: true,
    },
  });
  if (!catalogItem) {
    return apiErrorResponse(
      "NOT_FOUND",
      "Catalog item is not available to this organization",
      404,
    );
  }

  const command = (await request.json()) as CatalogBuilderCommand;
  try {
    const message = await executeCatalogBuilderCommand({
      db: prisma,
      command,
      catalogItem,
    });
    return NextResponse.json({ success: true, message });
  } catch (error) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : "Could not save",
      400,
    );
  }
}
