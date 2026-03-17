// packages/db/src/seed-platform-product.ts
// Bootstrap seed: registers the ODPF platform as its own first Digital Product.
// Run as part of initial setup or after schema migration.

import { PrismaClient } from "../generated/client";

const prisma = new PrismaClient();

export async function seedPlatformProduct() {
  console.log("Seeding platform product (DP-ODPF)...");

  // ─── 1. Digital Product ─────────────────────────────────────────────────
  const product = await prisma.digitalProduct.upsert({
    where: { productId: "DP-ODPF" },
    create: {
      productId: "DP-ODPF",
      name: "Open Digital Product Factory",
      description: "The platform itself — a digital product management system with AI coworker capabilities.",
      lifecycleStage: "production",
      lifecycleStatus: "active",
      version: "1.0.0",
    },
    update: {
      name: "Open Digital Product Factory",
      description: "The platform itself — a digital product management system with AI coworker capabilities.",
    },
    select: { id: true },
  });

  // ─── 2. Service Offering ────────────────────────────────────────────────
  await prisma.serviceOffering.upsert({
    where: { offeringId: "SO-ODPF-INTERNAL" },
    create: {
      offeringId: "SO-ODPF-INTERNAL",
      digitalProductId: product.id,
      name: "Internal Platform Access",
      description: "Full platform access for employees managing digital products, portfolios, and operations.",
      consumers: { roles: ["HR-100", "HR-200", "HR-300", "HR-400", "HR-500"], teams: [], integrations: [] },
      availabilityTarget: 99.0,
      mttrHours: 8,
      supportHours: "business_hours",
      status: "active",
      effectiveFrom: new Date(),
    },
    update: {
      name: "Internal Platform Access",
      availabilityTarget: 99.0,
      mttrHours: 8,
    },
  });

  // ─── 3. EA Elements (Design Topology) ───────────────────────────────────
  // Find element types — these are seeded by seed-ea-archimate4.ts
  const appComponentType = await prisma.eaElementType.findFirst({
    where: { slug: "application_component" },
    select: { id: true },
  });
  const techNodeType = await prisma.eaElementType.findFirst({
    where: { slug: "technology_node" },
    select: { id: true },
  });

  if (!appComponentType || !techNodeType) {
    console.warn("  EA element types not found — run seed-ea-archimate4 first. Skipping EA elements.");
    return;
  }

  const elements = [
    { name: "ODPF Portal",      typeId: appComponentType.id, desc: "Main Next.js web application" },
    { name: "ODPF Database",    typeId: techNodeType.id,     desc: "PostgreSQL via Prisma" },
    { name: "ODPF Graph",       typeId: techNodeType.id,     desc: "Neo4j for enterprise architecture" },
    { name: "ODPF AI Service",  typeId: techNodeType.id,     desc: "Ollama local inference" },
    { name: "ODPF Sandbox",     typeId: techNodeType.id,     desc: "Docker containers for isolated code generation" },
  ];

  const elementRecords: Array<{ id: string; name: string }> = [];
  for (const el of elements) {
    // Use a deterministic check — find by name + digitalProductId
    let record = await prisma.eaElement.findFirst({
      where: { name: el.name, digitalProductId: product.id },
      select: { id: true, name: true },
    });
    if (!record) {
      record = await prisma.eaElement.create({
        data: {
          name: el.name,
          elementTypeId: el.typeId,
          description: el.desc,
          digitalProductId: product.id,
          lifecycleStage: "production",
          lifecycleStatus: "active",
        },
        select: { id: true, name: true },
      });
    }
    elementRecords.push(record);
  }

  // ─── 4. EA Relationships (depends_on) ───────────────────────────────────
  // notationSlug lives on EaRelationship (not EaRelationshipType); use "archimate4" directly.
  const dependsOnType = await prisma.eaRelationshipType.findFirst({
    where: { slug: "depends_on" },
    select: { id: true },
  });

  if (!dependsOnType) {
    console.warn("  depends_on relationship type not found. Skipping relationships.");
    return;
  }

  const portal = elementRecords.find((e) => e.name === "ODPF Portal");
  const infraElements = elementRecords.filter((e) => e.name !== "ODPF Portal");

  if (portal) {
    for (const infra of infraElements) {
      const existing = await prisma.eaRelationship.findFirst({
        where: { fromElementId: portal.id, toElementId: infra.id, relationshipTypeId: dependsOnType.id },
      });
      if (!existing) {
        await prisma.eaRelationship.create({
          data: {
            fromElementId: portal.id,
            toElementId: infra.id,
            relationshipTypeId: dependsOnType.id,
            notationSlug: "archimate4",
          },
        });
      }
    }
  }

  console.log("  DP-ODPF seeded with 5 EA elements and 4 depends_on relationships.");
}

// Allow direct execution
if (require.main === module) {
  seedPlatformProduct()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
