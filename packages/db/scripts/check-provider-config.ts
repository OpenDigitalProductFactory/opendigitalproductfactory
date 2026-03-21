import { prisma } from "../src/index.js";

async function main() {
  const p = await prisma.modelProvider.findUnique({
    where: { providerId: "anthropic-sub" },
    select: { baseUrl: true, endpoint: true, authMethod: true, authHeader: true, status: true },
  });
  console.log("anthropic-sub config:", JSON.stringify(p, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
