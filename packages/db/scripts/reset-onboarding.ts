import { prisma } from "../src/client";

/**
 * Reset onboarding state so the user enters the setup flow from scratch.
 * Does NOT reset the user account, providers, or platform data — just the
 * setup progress and the placeholder org created during earlier testing.
 */
async function main() {
  // 1. Delete all setup progress records
  const deleted = await prisma.platformSetupProgress.deleteMany({});
  console.log(`Deleted ${deleted.count} setup progress record(s)`);

  // 2. Delete placeholder org(s) created during testing
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, slug: true } });
  for (const org of orgs) {
    // Delete dependent records first (branding, storefront config)
    await prisma.brandingConfig.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.storefrontConfig.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } });
    console.log(`Deleted org: ${org.name} (${org.slug})`);
  }

  // 3. Verify isFirstRun will return true
  const orgCount = await prisma.organization.count();
  const progressCount = await prisma.platformSetupProgress.count();
  console.log(`\nState after reset:`);
  console.log(`  Organizations: ${orgCount}`);
  console.log(`  Setup progress records: ${progressCount}`);
  console.log(`  isFirstRun: ${orgCount === 0 && progressCount === 0}`);
  console.log(`\nRefresh the platform — you'll be redirected to /setup`);

  await prisma.$disconnect();
}

main().catch(console.error);
