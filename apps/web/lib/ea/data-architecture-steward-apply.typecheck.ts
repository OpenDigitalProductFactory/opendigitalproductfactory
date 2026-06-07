// Compile-time guard for EP-DATA-ARCH Phase 4 (BI-6E5BF91F).
//
// The steward applier writes EaConformanceIssue rows through a narrow client
// interface for testability. This never-executed function passes the same
// payloads through the REAL prisma client types so `tsc --noEmit` validates the
// field names/shapes against the schema.

import { prisma, type Prisma } from "@dpf/db";

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function __typecheckStewardWrites(): Promise<void> {
  if (process.env.__NEVER__ !== "1") return;

  await prisma.eaConformanceIssue.create({
    data: {
      viewId: null,
      issueType: "fk-without-index",
      severity: "warn",
      status: "open",
      message: "m",
      detailsJson: { issueKey: "k", steward: true } as Prisma.InputJsonValue,
    },
  });

  await prisma.eaConformanceIssue.update({
    where: { id: "x" },
    data: { message: "m", severity: "warn", detailsJson: {} as Prisma.InputJsonValue },
  });

  await prisma.eaConformanceIssue.update({ where: { id: "x" }, data: { status: "resolved" } });

  await prisma.eaConformanceIssue.findMany({
    where: { issueType: { in: ["fk-without-index"] }, status: "open" },
    select: { id: true, issueType: true, message: true, severity: true, detailsJson: true },
  });

  await prisma.eaView.findFirst({ where: { scopeType: "data-model", scopeRef: "prisma" } });
}
