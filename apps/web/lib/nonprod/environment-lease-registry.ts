import { prisma } from "@dpf/db";

type LeaseDb = Pick<typeof prisma, "nonProductionEnvironmentLease">;

export async function listActiveNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return db.nonProductionEnvironmentLease.findMany({
    where: { status: "active", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listQueuedNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return db.nonProductionEnvironmentLease.findMany({
    where: { status: "queued", expiresAt: { gt: now } },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
}

/** One snapshot for host-capacity arbitration across active and queued work. */
export async function listCapacityReservingNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return db.nonProductionEnvironmentLease.findMany({
    where: {
      status: { in: ["active", "queued"] },
      expiresAt: { gt: now },
    },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
}
