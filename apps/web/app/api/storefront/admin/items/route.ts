import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { apiErrorResponse } from "@/lib/api/error";
import {
  ensureStorefrontCommercialChain,
  projectStorefrontCatalogRow,
  resolveCatalogProductLineSelection,
  type StorefrontCommercialCatalogClient,
} from "@/lib/products/commercial-catalog";

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) {
    return NextResponse.json({ error: "No storefront configured" }, { status: 404 });
  }

  const items = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id },
    orderBy: { sortOrder: "asc" },
    include: {
      catalogItem: {
        select: {
          catalogItemId: true,
          name: true,
          description: true,
          priceType: true,
          priceAmount: true,
          priceCurrency: true,
          quoteRequired: true,
          status: true,
        },
      },
    },
  });

  return NextResponse.json(
    items.map(projectStorefrontCatalogRow),
  );
}

type CreateItemBody = {
  name: string;
  description?: string;
  category?: string;
  ctaType: string;
  priceType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  imageUrl?: string;
  ctaLabel?: string;
  bookingConfig?: {
    durationMinutes: number;
    schedulingPattern?: string;
    assignmentMode?: string;
    capacity?: number;
    beforeBufferMinutes?: number;
    afterBufferMinutes?: number;
  };
  goalAmount?: number;
  suggestedAmount?: number;
  productLineId?: string | null;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      organizationId: true,
    },
  });
  if (!config) {
    return NextResponse.json({ error: "No storefront configured" }, { status: 404 });
  }

  const body = (await req.json()) as CreateItemBody;
  if (!body.name || !body.ctaType) {
    return NextResponse.json({ error: "name and ctaType are required" }, { status: 400 });
  }

  // Generate item ID
  const uuid = crypto.randomUUID().slice(0, 8).toUpperCase();
  const itemId = `ITEM-${uuid}`;

  // Get next sort order
  const lastItem = await prisma.storefrontItem.findFirst({
    where: { storefrontId: config.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = (lastItem?.sortOrder ?? -1) + 1;

  // Build bookingConfig JSON for booking and donation items
  let bookingConfig: Record<string, string | number | boolean> | undefined = undefined;
  if (body.ctaType === "booking" && body.bookingConfig) {
    bookingConfig = {
      durationMinutes: body.bookingConfig.durationMinutes,
      schedulingPattern: body.bookingConfig.schedulingPattern ?? "slot",
      assignmentMode: body.bookingConfig.assignmentMode ?? "next-available",
      ...(body.bookingConfig.capacity != null && { capacity: body.bookingConfig.capacity }),
      ...(body.bookingConfig.beforeBufferMinutes != null && { beforeBufferMinutes: body.bookingConfig.beforeBufferMinutes }),
      ...(body.bookingConfig.afterBufferMinutes != null && { afterBufferMinutes: body.bookingConfig.afterBufferMinutes }),
    };
  }
  if (body.ctaType === "donation") {
    bookingConfig = {
      ...(body.goalAmount != null && { goalAmount: body.goalAmount }),
      ...(body.suggestedAmount != null && { suggestedAmount: body.suggestedAmount }),
    };
  }

  const orgSettingsRow = await prisma.orgSettings.findFirst({ select: { baseCurrency: true } });

  const priceCurrency =
    body.priceCurrency ?? orgSettingsRow?.baseCurrency ?? "USD";
  const productLines = await prisma.productLine.findMany({
    where: {
      organizationId: config.organizationId,
      effectiveTo: null,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const requestedProductLineId = body.productLineId?.trim() || null;
  const productLineSelection = resolveCatalogProductLineSelection(
    productLines,
    requestedProductLineId,
  );
  if (productLineSelection.error) {
    return apiErrorResponse(
      "INVALID_ARGUMENT",
      productLineSelection.error,
      400,
    );
  }

  const item = await prisma.$transaction(async (tx) => {
    const commercial = await ensureStorefrontCommercialChain({
      db: tx as unknown as StorefrontCommercialCatalogClient,
      organizationId: config.organizationId,
      productLineId: productLineSelection.productLineId,
      name: body.name,
      description: body.description ?? null,
      priceType: body.priceType ?? null,
      priceAmount: body.priceAmount ?? null,
      priceCurrency,
      sourceRef: itemId,
    });

    return tx.storefrontItem.create({
      data: {
        itemId,
        storefrontId: config.id,
        catalogItemId: commercial.catalogItemId,
        name: body.name,
        description: body.description ?? null,
        category: body.category ?? null,
        ctaType: body.ctaType,
        priceType: body.priceType ?? null,
        priceAmount: body.priceAmount != null ? body.priceAmount : null,
        priceCurrency,
        imageUrl: body.imageUrl ?? null,
        ctaLabel: body.ctaLabel ?? null,
        ...(bookingConfig && { bookingConfig }),
        isActive: true,
        sortOrder,
      },
    });
  });

  // For booking items, link to all active providers
  if (body.ctaType === "booking") {
    const providers = await prisma.serviceProvider.findMany({
      where: { storefrontId: config.id, isActive: true },
      select: { id: true },
    });
    if (providers.length > 0) {
      await prisma.providerService.createMany({
        data: providers.map((p) => ({
          providerId: p.id,
          itemId: item.id,
        })),
        skipDuplicates: true,
      });
    }
  }

  return NextResponse.json({
    ...item,
    priceAmount: item.priceAmount?.toString() ?? null,
  }, { status: 201 });
}
