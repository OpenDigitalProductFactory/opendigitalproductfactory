import { prisma } from "../src/client";

async function main() {
  const result = await prisma.modelProfile.update({
    where: { providerId_modelId: { providerId: "ollama", modelId: "llama3.1:8b" } },
    data: {
      capabilities: { toolUse: false, structuredOutput: false, streaming: true },
    },
  });
  console.log("Updated capabilities:", JSON.stringify(result.capabilities));
  await prisma.$disconnect();
}

main().catch(console.error);
