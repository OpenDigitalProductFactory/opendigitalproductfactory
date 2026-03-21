import { prisma } from "../src/index.js";

async function main() {
  // Clear stale provider priority that points to deactivated providers
  await prisma.platformConfig.deleteMany({
    where: { key: "provider_priority" },
  });
  console.log("Cleared provider_priority config — bootstrap will recalculate from active providers");

  await prisma.$disconnect();
}

main().catch(console.error);
