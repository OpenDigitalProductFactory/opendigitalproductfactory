import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { apiErrorResponse } from "@/lib/api/error";
import { newId } from "@/lib/shared/new-id";

// Operator door for the stock coverage starter: define the supplies you count
// and, optionally, how much of each a menu item uses. One route rather than two
// because "an ingredient and where it is used" is a single operator thought.

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const items = await prisma.stockItem.findMany({
    orderBy: { name: "asc" },
    select: {
      stockItemId: true,
      name: true,
      unit: true,
      onHandQuantity: true,
      reorderPoint: true,
      reorderQuantity: true,
      isActive: true,
      supplier: { select: { name: true } },
      components: {
        select: {
          quantityPerUnit: true,
          storefrontItem: { select: { itemId: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json(
    items.map((item) => ({
      ...item,
      onHandQuantity: item.onHandQuantity.toString(),
      reorderPoint: item.reorderPoint.toString(),
      reorderQuantity: item.reorderQuantity.toString(),
      supplierName: item.supplier?.name ?? null,
      components: item.components.map((c) => ({
        storefrontItemId: c.storefrontItem.itemId,
        storefrontItemName: c.storefrontItem.name,
        quantityPerUnit: c.quantityPerUnit.toString(),
      })),
    })),
  );
}

type UsedByLine = { storefrontItemId?: unknown; quantityPerUnit?: unknown };

type CreateStockItemBody = {
  name?: unknown;
  unit?: unknown;
  onHandQuantity?: unknown;
  reorderPoint?: unknown;
  reorderQuantity?: unknown;
  supplierName?: unknown;
  /** Optional recipe lines: which sellable items consume this supply. */
  usedBy?: unknown;
};

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const body = (await req.json().catch(() => ({}))) as CreateStockItemBody;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const unit = typeof body.unit === "string" ? body.unit.trim() : "";
  if (!name || !unit) {
    return apiErrorResponse("INVALID_INPUT", "name and unit are required", 400);
  }

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  if (!organization) {
    return apiErrorResponse("NOT_FOUND", "Organization not found", 400);
  }

  const supplierName = typeof body.supplierName === "string" ? body.supplierName.trim() : "";
  const supplier = supplierName
    ? await prisma.supplier.findFirst({ where: { name: supplierName }, select: { id: true } })
    : null;

  const data = {
    organizationId: organization.id,
    name,
    unit,
    onHandQuantity: num(body.onHandQuantity),
    reorderPoint: num(body.reorderPoint),
    reorderQuantity: num(body.reorderQuantity),
    supplierId: supplier?.id ?? null,
    isActive: true,
  };

  // Idempotent on (organization, name) so a harness or a re-submitted form
  // updates the level instead of failing on the unique index.
  const stockItem = await prisma.stockItem.upsert({
    where: { organizationId_name: { organizationId: organization.id, name } },
    update: data,
    create: { ...data, stockItemId: `stk-${newId(8)}` },
    select: { id: true, stockItemId: true, name: true },
  });

  const usedBy = Array.isArray(body.usedBy) ? (body.usedBy as UsedByLine[]) : [];
  let componentsLinked = 0;
  for (const line of usedBy) {
    const itemRef = typeof line.storefrontItemId === "string" ? line.storefrontItemId.trim() : "";
    const quantityPerUnit = num(line.quantityPerUnit);
    if (!itemRef || quantityPerUnit <= 0) continue;
    const storefrontItem = await prisma.storefrontItem.findFirst({
      where: { itemId: itemRef },
      select: { id: true },
    });
    if (!storefrontItem) continue;
    await prisma.storefrontItemComponent.upsert({
      where: {
        storefrontItemId_stockItemId: {
          storefrontItemId: storefrontItem.id,
          stockItemId: stockItem.id,
        },
      },
      update: { quantityPerUnit },
      create: { storefrontItemId: storefrontItem.id, stockItemId: stockItem.id, quantityPerUnit },
    });
    componentsLinked++;
  }

  return NextResponse.json(
    { stockItemId: stockItem.stockItemId, name: stockItem.name, componentsLinked },
    { status: 201 },
  );
}
