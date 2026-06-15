// Compile-time guard for EP-DATA-ARCH Phase 2 (BI-2167A734).
//
// The mirror applier writes through a narrow MirrorPrismaClient interface for
// testability, which means `tsc` does NOT otherwise validate the create/update
// payload field names against the real Prisma schema. This file passes the
// exact payloads through the REAL prisma client types. It is never executed
// (no DB connection) — it exists purely so `tsc --noEmit` fails if any EA
// field name or shape drifts from the schema.

import { prisma, type Prisma } from "@dpf/db";

import { elementCreateData, relationshipCreateData, type MirrorContext } from "./data-model-mirror-apply";
import type { DesiredElement, DesiredRelationship } from "./data-model-mirror";

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function __typecheckMirrorWrites(): Promise<void> {
  // Guarded so this never runs even if accidentally imported at runtime.
  if (process.env.__NEVER__ !== "1") return;

  const ctx = {} as MirrorContext;
  const el = {} as DesiredElement;
  const rel = {} as DesiredRelationship;

  await prisma.eaElement.create({ data: { ...elementCreateData(ctx, el), createdById: null } });
  await prisma.eaElement.update({
    where: { id: "x" },
    data: { name: "n", lifecycleStatus: "active", properties: {} as Prisma.InputJsonValue },
  });

  await prisma.eaRelationship.create({
    data: { ...relationshipCreateData(ctx, rel, "from", "to"), createdById: null },
  });
  await prisma.eaRelationship.update({
    where: { id: "x" },
    data: { properties: {} as Prisma.InputJsonValue },
  });

  await prisma.eaViewElement.create({ data: { viewId: "v", elementId: "e", mode: "existing" } });

  await prisma.eaSnapshot.create({
    data: {
      viewId: "v",
      elementCount: 1,
      relationshipCount: 1,
      changeSummary: "summary",
      graphJson: {} as Prisma.InputJsonValue,
    },
  });

  await prisma.eaConformanceIssue.create({
    data: {
      viewId: "v",
      issueType: "mirror-duplicate-source-key",
      severity: "error",
      status: "open",
      message: "m",
      detailsJson: {} as Prisma.InputJsonValue,
    },
  });

  await prisma.eaView.create({
    data: {
      notationId: "n",
      name: "Data Model",
      description: "d",
      layoutType: "graph",
      scopeType: "data-model",
      scopeRef: "prisma",
      viewpointId: "vp",
      status: "draft",
    },
  });

  await prisma.viewpointDefinition.upsert({
    where: { name: "Data Model" },
    update: { description: "d", allowedElementTypeSlugs: ["data_object"], allowedRelTypeSlugs: ["associated_with"] },
    create: { name: "Data Model", description: "d", allowedElementTypeSlugs: ["data_object"], allowedRelTypeSlugs: ["associated_with"] },
  });
}
