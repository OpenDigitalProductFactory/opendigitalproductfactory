import { prisma } from "./client.js";
import { syncCapabilities } from "./sync-capabilities.js";

try {
  await syncCapabilities(prisma);
} catch (e) {
  console.error("OUTER ERROR:", e);
} finally {
  await prisma.$disconnect();
}
