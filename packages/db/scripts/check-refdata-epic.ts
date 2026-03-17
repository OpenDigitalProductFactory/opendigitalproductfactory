import { prisma } from "../src/client";

async function main() {
  const e = await prisma.epic.findFirst({
    where: { title: { contains: "Reference Data" } },
    include: { items: true },
  });
  if (!e) {
    console.log("Epic not found");
    return;
  }
  console.log(e.title, "|", e.status, "|", e.items.length, "items");
  for (const i of e.items) {
    console.log(" ", i.id, "|", i.title, "|", i.status);
  }
}

main().finally(() => prisma.$disconnect());
