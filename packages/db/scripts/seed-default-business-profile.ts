// One-off script: seed default business profile with deployment windows
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-default-business-profile.ts
import { prisma } from "../src/client";

async function main() {
  console.log("Seeding default business profile...");

  // 1. Upsert the default business profile
  const profile = await prisma.businessProfile.upsert({
    where: { profileKey: "default" },
    create: {
      profileKey: "default",
      name: "Default Business Profile",
      isActive: true,
      timezone: "UTC",
      hasStorefront: false,
      businessHours: {
        monday:    { open: "08:00", close: "18:00" },
        tuesday:   { open: "08:00", close: "18:00" },
        wednesday: { open: "08:00", close: "18:00" },
        thursday:  { open: "08:00", close: "18:00" },
        friday:    { open: "08:00", close: "18:00" },
        saturday:  null,
        sunday:    null,
      },
    },
    update: {},
  });

  console.log(`  Business profile: ${profile.name} (${profile.profileKey}) — id: ${profile.id}`);

  // 2. Upsert deployment windows
  const windows = [
    {
      windowKey: "weeknight-maintenance",
      name: "Weeknight Maintenance",
      description: "Standard maintenance window on weeknight evenings (Mon-Thu)",
      // 1=Mon, 2=Tue, 3=Wed, 4=Thu
      dayOfWeek: [1, 2, 3, 4],
      startTime: "20:00",
      endTime: "06:00",
      allowedChangeTypes: ["standard", "normal"],
      allowedRiskLevels: ["low", "medium"],
      enforcement: "advisory",
    },
    {
      windowKey: "weekend-maintenance",
      name: "Weekend Maintenance",
      description: "Full-weekend maintenance window (Sat-Sun, all day)",
      // 6=Sat, 0=Sun
      dayOfWeek: [6, 0],
      startTime: "00:00",
      endTime: "23:59",
      allowedChangeTypes: ["standard", "normal", "emergency"],
      allowedRiskLevels: ["low", "medium", "high", "critical"],
      enforcement: "advisory",
    },
  ];

  for (const win of windows) {
    const existing = await prisma.deploymentWindow.findUnique({
      where: { windowKey: win.windowKey },
    });

    if (existing) {
      console.log(`  Deployment window already exists: ${win.name} (${win.windowKey})`);
      continue;
    }

    const created = await prisma.deploymentWindow.create({
      data: {
        businessProfileId: profile.id,
        windowKey: win.windowKey,
        name: win.name,
        description: win.description,
        dayOfWeek: win.dayOfWeek,
        startTime: win.startTime,
        endTime: win.endTime,
        allowedChangeTypes: win.allowedChangeTypes,
        allowedRiskLevels: win.allowedRiskLevels,
        enforcement: win.enforcement,
      },
    });

    console.log(`  Created deployment window: ${created.name} (${created.windowKey})`);
  }

  // 3. No blackout periods initially
  console.log("  No blackout periods seeded (none required at initial setup).");

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
