import { prisma } from "../src/client";

async function main() {
  const ollama = await prisma.modelProvider.findUnique({
    where: { providerId: "ollama" },
    select: { sensitivityClearance: true, status: true },
  });
  console.log("Ollama:", JSON.stringify(ollama));

  if (!ollama?.sensitivityClearance?.length) {
    console.log("Sensitivity clearance is EMPTY — fixing...");
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: { sensitivityClearance: ["public", "internal", "confidential", "restricted"] },
    });
    console.log("Fixed.");
  } else if (!ollama.sensitivityClearance.includes("confidential")) {
    console.log("Missing 'confidential' — fixing...");
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: { sensitivityClearance: ["public", "internal", "confidential", "restricted"] },
    });
    console.log("Fixed.");
  } else {
    console.log("Sensitivity clearance looks correct.");
  }

  await prisma.$disconnect();
}

main().catch(console.error);
