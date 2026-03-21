import { prisma } from "../src/client";

async function main() {
  const all = await prisma.modelProvider.findMany({
    select: { providerId: true, name: true, status: true, authMethod: true },
    orderBy: { providerId: "asc" },
  });
  console.log("ALL PROVIDERS IN DB:");
  for (const p of all) {
    console.log(`  ${p.providerId.padEnd(20)} ${p.name.padEnd(30)} status=${p.status.padEnd(15)} auth=${p.authMethod}`);
  }
  console.log(`\nTotal: ${all.length}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
