import { prisma } from "../src/client";

async function main() {
  // Delete stale setup progress with old step names
  const deleted = await prisma.platformSetupProgress.deleteMany({});
  console.log(`Deleted ${deleted.count} stale setup progress record(s)`);

  // Get the existing user
  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) {
    console.log("No user found — the /setup page will handle account creation");
    await prisma.$disconnect();
    return;
  }

  // Create fresh progress with new step names, bootstrap already done
  const steps = {
    "account-bootstrap": "completed",  // user already exists
    "ai-providers": "pending",
    "branding": "pending",
    "org-settings": "pending",
    "workspace": "pending",
  };

  const progress = await prisma.platformSetupProgress.create({
    data: {
      userId: user.id,
      currentStep: "ai-providers",  // skip bootstrap, start with AI providers
      steps,
      context: {},
    },
  });

  console.log(`Created fresh setup progress: ${progress.id}`);
  console.log(`  currentStep: ${progress.currentStep}`);
  console.log(`  userId: ${user.id} (${user.email})`);
  console.log(`\nThe setup overlay will appear when you navigate to /platform/ai/providers`);

  // Also need an org for the shell to not redirect to /setup
  const orgCount = await prisma.organization.count();
  if (orgCount === 0) {
    const org = await prisma.organization.create({
      data: {
        orgId: `ORG-${Date.now()}`,
        name: "My Organization",
        slug: "my-org",
      },
    });
    await prisma.platformSetupProgress.update({
      where: { id: progress.id },
      data: { organizationId: org.id },
    });
    console.log(`\nCreated placeholder org: ${org.name} (${org.orgId})`);
    console.log("Update the org name from /admin/settings during the tour");
  }

  await prisma.$disconnect();
}

main().catch(console.error);
