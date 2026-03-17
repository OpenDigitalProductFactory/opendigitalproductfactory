import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function archive() {
  // Create the unified coworker agent row
  await prisma.agent.upsert({
    where: { agentId: "coworker" },
    update: { name: "Coworker", type: "orchestrator", status: "active", archived: false },
    create: { agentId: "coworker", name: "Coworker", tier: 1, type: "orchestrator", status: "active", archived: false },
  });

  // Archive all persona agents
  const personaIds = [
    "portfolio-advisor", "inventory-specialist", "ea-architect",
    "hr-specialist", "customer-advisor", "ops-coordinator",
    "platform-engineer", "build-specialist", "admin-assistant", "coo",
  ];
  const result = await prisma.agent.updateMany({
    where: { agentId: { in: personaIds } },
    data: { archived: true },
  });
  console.log(`Archived ${result.count} persona agents. Created/updated coworker agent.`);
  await prisma.$disconnect();
}

archive().catch(console.error);
