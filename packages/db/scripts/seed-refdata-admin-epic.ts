import { prisma } from "../src/client";

async function main() {
  const epic = await prisma.epic.upsert({
    where: { epicId: "EP-REF-002" },
    create: {
      epicId: "EP-REF-002",
      title: "Admin Reference Data Management",
      status: "done",
    },
    update: {},
  });
  console.log("Epic:", epic.title, "→", epic.status);

  const item = await prisma.backlogItem.upsert({
    where: { itemId: "BI-REF-002-01" },
    create: {
      itemId: "BI-REF-002-01",
      title: "Admin page for managing geographic reference data and work location address linking",
      type: "product",
      status: "done",
      priority: 1,
      epicId: epic.id,
      completedAt: new Date(),
    },
    update: {},
  });
  console.log("Item:", item.title, "→", item.status);
}

main().finally(() => prisma.$disconnect());
