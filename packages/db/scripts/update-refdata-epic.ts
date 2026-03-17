import { prisma } from "../src/client";

async function main() {
  const itemIds = [
    "08ecab91-2af8-455d-b445-2a66963c17d1", // Location reference data
    "c5b03209-6a54-42c7-9bdc-1289f1a8d3c9", // Address and phone fields
    "2ad68c81-23d4-4130-9363-9c06058f490e", // Calendar date picker
  ];

  const now = new Date();

  for (const id of itemIds) {
    await prisma.backlogItem.update({
      where: { id },
      data: { status: "done", completedAt: now },
    });
    console.log(`Updated ${id} → done`);
  }

  // Also mark the epic as done
  const epic = await prisma.epic.findFirst({
    where: { title: { contains: "Reference Data" } },
  });
  if (epic) {
    await prisma.epic.update({
      where: { id: epic.id },
      data: { status: "done" },
    });
    console.log(`Epic "${epic.title}" → done`);
  }
}

main().finally(() => prisma.$disconnect());
