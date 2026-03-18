import { readFileSync } from "fs";
import { prisma } from "../packages/db/src/client";

async function main() {
  // Host profile from installer (passed via env var)
  const hostProfile = process.env.DPF_HOST_PROFILE
    ? JSON.parse(process.env.DPF_HOST_PROFILE)
    : null;

  // Container resources
  const meminfo = readFileSync("/proc/meminfo", "utf-8");
  const memMatch = meminfo.match(/MemTotal:\s+(\d+)/);
  const containerMemMB = memMatch ? Math.round(parseInt(memMatch[1]!, 10) / 1024) : null;

  let containerCpus: number | null = null;
  try {
    const cpuinfo = readFileSync("/proc/cpuinfo", "utf-8");
    containerCpus = (cpuinfo.match(/^processor/gm) || []).length;
  } catch { /* ignore */ }

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

}

main().catch((e) => {
  console.error("Hardware detection error:", e);
  process.exit(0); // Non-fatal — don't block startup
});
