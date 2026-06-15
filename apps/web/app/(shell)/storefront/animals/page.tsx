import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { AnimalsManager } from "@/components/storefront-admin/AnimalsManager";
import { listOwnerMedia } from "@/lib/media";

export default async function AnimalsPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      sections: { select: { type: true } },
    },
  });
  if (!config) redirect("/storefront/setup");

  const hasAnimalsSection = config.sections.some((s) => s.type === "animals-available");

  const animals = await prisma.adoptableAnimal.findMany({
    where: { storefrontId: config.id },
    orderBy: [{ status: "asc" }, { sortOrder: "asc" }],
  });

  const withMedia = await Promise.all(
    animals.map(async (a) => ({
      id: a.id,
      name: a.name,
      species: a.species,
      breed: a.breed,
      age: a.age,
      sex: a.sex,
      size: a.size,
      description: a.description,
      status: a.status,
      media: await listOwnerMedia("AdoptableAnimal", a.id),
    })),
  );

  return <AnimalsManager animals={withMedia} hasAnimalsSection={hasAnimalsSection} />;
}
