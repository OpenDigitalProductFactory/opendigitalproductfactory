import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { UnitsManager } from "@/components/storefront-admin/UnitsManager";
import { listOwnerMedia } from "@/lib/media";

export default async function UnitsPage() {
  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) redirect("/storefront/setup");

  const classes = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id, ctaType: "rental", isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  const units = await prisma.rentableUnit.findMany({
    where: { storefrontId: config.id },
    orderBy: [{ storefrontItemId: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      unitId: true,
      storefrontItemId: true,
      label: true,
      unitRef: true,
      status: true,
    },
  });

  const withMedia = await Promise.all(
    units.map(async (u) => ({
      ...u,
      media: await listOwnerMedia("RentableUnit", u.id, "equipment"),
    })),
  );

  return <UnitsManager classes={classes} units={withMedia} />;
}
