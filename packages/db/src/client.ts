import { PrismaClient } from "../generated/client/client";
import { PrismaPg } from "@prisma/adapter-pg";

/** Explicit, independently owned connection for admitted disposable databases.
 * Never alters the application's singleton or process DATABASE_URL. */
export function createDatabaseClient(connectionString: string) {
  if (!connectionString) throw new Error("Database connection string is required");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
