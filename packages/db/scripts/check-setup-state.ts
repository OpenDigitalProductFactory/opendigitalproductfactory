import { prisma } from "../src/client";

async function main() {
  const orgs = await prisma.organization.count();
  const users = await prisma.user.count();
  const progress = await prisma.platformSetupProgress.findFirst({
    orderBy: { createdAt: "desc" },
  });

  console.log("=== Setup State ===");
  console.log(`Organizations: ${orgs}`);
  console.log(`Users: ${users}`);
  console.log(`isFirstRun would return: ${orgs === 0 && !progress?.completedAt}`);

  if (progress) {
    console.log(`\nSetup progress: ${progress.id}`);
    console.log(`  currentStep: ${progress.currentStep}`);
    console.log(`  completedAt: ${progress.completedAt ?? "null (in progress)"}`);
    console.log(`  steps: ${JSON.stringify(progress.steps)}`);
  } else {
    console.log("\nNo PlatformSetupProgress record found.");
  }

  await prisma.$disconnect();
}

main().catch(console.error);
