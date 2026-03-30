/**
 * Detect container hardware profile and persist to PlatformConfig.
 * Runs inside portal-init when DPF_HOST_PROFILE is set.
 * Non-fatal — exits 0 even on error so it doesn't block startup.
 */
import { prisma } from "../src/client";
import { readFileSync } from "fs";

async function main() {
  const hostProfile = process.env.DPF_HOST_PROFILE
    ? JSON.parse(process.env.DPF_HOST_PROFILE)
    : null;

  // Container resources from /proc
  let containerMemMB: number | null = null;
  let containerCpus: number | null = null;
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf-8");
    const memMatch = meminfo.match(/MemTotal:\s+(\d+)/);
    containerMemMB = memMatch ? Math.round(parseInt(memMatch[1]!, 10) / 1024) : null;
  } catch { /* not available on this platform */ }

  try {
    const cpuinfo = readFileSync("/proc/cpuinfo", "utf-8");
    containerCpus = (cpuinfo.match(/^processor/gm) || []).length;
  } catch { /* not available on this platform */ }

  const containerProfile = {
    memoryMB: containerMemMB,
    cpus: containerCpus,
    detectedAt: new Date().toISOString(),
  };

  if (hostProfile) {
    await prisma.platformConfig.upsert({
      where: { key: "host_profile" },
      update: { value: hostProfile },
      create: { key: "host_profile", value: hostProfile },
    });
    console.log("  Host profile:", JSON.stringify(hostProfile));
  }

  await prisma.platformConfig.upsert({
    where: { key: "container_profile" },
    update: { value: containerProfile },
    create: { key: "container_profile", value: containerProfile },
  });
  console.log("  Container profile:", JSON.stringify(containerProfile));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Hardware detection error:", e);
  process.exit(0); // Non-fatal
});
