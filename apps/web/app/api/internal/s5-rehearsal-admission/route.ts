import { prisma } from "@dpf/db";
import { createS5RehearsalOwnerHandler, createS5RehearsalOwnerReads } from "@/lib/workroom-runtime/s5-rehearsal-owner.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createS5RehearsalOwnerHandler({
  env: process.env,
  withOwnerRead: (read) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return read(createS5RehearsalOwnerReads(tx));
  }, { isolationLevel: "RepeatableRead" }),
});
