// One-off script: seed the 5 portfolio operations & ontology epics
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-portfolio-ops-epics.ts
import { randomUUID } from "crypto";
import { prisma } from "../src/client";

async function main() {
  // 1. Get portfolio IDs
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true, name: true },
  });
  const bySlug = Object.fromEntries(portfolios.map((p) => [p.slug, p]));

  console.log("Portfolios found:", portfolios.map((p) => p.slug));

  const foundational = bySlug["foundational"];
  const mfgDelivery = bySlug["manufacturing_and_delivery"];
  const forEmployees = bySlug["for_employees"];
  const productsSold = bySlug["products_and_services_sold"];

  if (!foundational || !mfgDelivery) {
    throw new Error("Expected portfolios not found — run the seed first.");
  }

  // 2. Define epics + portfolio links + stories
  const epics = [
    {
      epicId: "EP-FOUND-OPS",
      title: "Foundation Portfolio Operations Console",
      description:
        "Operational interface for Foundation portfolio owners to manage underlying technology. Combines infrastructure dashboard, lightweight health probes (container, database, service, image), operational dependency graph with impact analysis, and probe history/trend analysis. Builds on existing InventoryEntity and InventoryRelationship models. Future-proofed for cloud and distributed deployment.",
      status: "open" as const,
      portfolioSlugs: ["foundational"],
      stories: [
        { title: "HealthProbe and HealthSnapshot schema models with migration", type: "portfolio" as const, status: "open" as const, priority: 1 },
        { title: "HealthRollup model for hourly and daily aggregation with retention policy", type: "portfolio" as const, status: "open" as const, priority: 2 },
        { title: "ProbeExecutor interface and DockerContainerProbeExecutor implementation", type: "portfolio" as const, status: "open" as const, priority: 3 },
        { title: "PostgresProbeExecutor for database connectivity and capacity checks", type: "portfolio" as const, status: "open" as const, priority: 4 },
        { title: "HttpServiceProbeExecutor for endpoint reachability and TLS checks", type: "portfolio" as const, status: "open" as const, priority: 5 },
        { title: "ContainerImageProbeExecutor for version currency and vulnerability scan age", type: "portfolio" as const, status: "open" as const, priority: 6 },
        { title: "CalendarEvent integration for probe scheduling at configurable intervals", type: "portfolio" as const, status: "open" as const, priority: 7 },
        { title: "Default probe auto-creation on bootstrap discovery completion", type: "portfolio" as const, status: "open" as const, priority: 8 },
        { title: "/portfolio/foundational/ops route with tab-based layout (Overview, Containers, Databases, Services, Images, Quality)", type: "portfolio" as const, status: "open" as const, priority: 9 },
        { title: "Entity detail panel with health sparkline, attribution, relationships, and probe config", type: "portfolio" as const, status: "open" as const, priority: 10 },
        { title: "Operational dependency graph API (/api/portfolio/foundational/ops/graph)", type: "portfolio" as const, status: "open" as const, priority: 11 },
        { title: "Client-side graph rendering with force-directed and hierarchical layouts", type: "portfolio" as const, status: "open" as const, priority: 12 },
        { title: "Impact analysis API (/api/portfolio/foundational/ops/impact/:entityId) with downstream traversal", type: "portfolio" as const, status: "open" as const, priority: 13 },
        { title: "Impact analysis overlay mode on dependency graph (select node, highlight blast radius)", type: "portfolio" as const, status: "open" as const, priority: 14 },
        { title: "Probe history timeline views (24h raw, 7d hourly rollup, 90d daily rollup)", type: "portfolio" as const, status: "open" as const, priority: 15 },
        { title: "Fleet health summary with distribution chart, top degraded entities, recent status changes", type: "portfolio" as const, status: "open" as const, priority: 16 },
        { title: "Advisory alerting via PortfolioQualityIssue on health status transitions", type: "portfolio" as const, status: "open" as const, priority: 17 },
        { title: "Snapshot retention cleanup task (7-day raw, 90-day hourly rollup)", type: "portfolio" as const, status: "open" as const, priority: 18 },
      ],
    },
    {
      epicId: "EP-CHG-MGMT",
      title: "Change & Deployment Management",
      description:
        "ITIL-style change management process covering platform changes and customer-managed external systems. RFC umbrella model above existing ChangePromotion, with business-aware deployment windows derived from operating hours and storefront traffic. Impact analysis integration with operational graph. Maintenance window enforcement via calendar, booking blocks, and status banners. Standard change catalog for pre-approved routine operations.",
      status: "open" as const,
      portfolioSlugs: ["foundational", "manufacturing_and_delivery"],
      stories: [
        { title: "ChangeRequest and ChangeItem schema models with migration", type: "portfolio" as const, status: "open" as const, priority: 1 },
        { title: "BusinessProfile model with operating hours, timezone, storefront awareness", type: "portfolio" as const, status: "open" as const, priority: 2 },
        { title: "DeploymentWindow model with day/time schedule, concurrency limits, enforcement mode", type: "portfolio" as const, status: "open" as const, priority: 3 },
        { title: "BlackoutPeriod model with date range, scope, emergency exceptions", type: "portfolio" as const, status: "open" as const, priority: 4 },
        { title: "RFC lifecycle state machine (draft→submitted→assessed→approved→scheduled→in-progress→completed→closed)", type: "portfolio" as const, status: "open" as const, priority: 5 },
        { title: "Emergency change expedited path (enter at in-progress, retrospective assessment)", type: "portfolio" as const, status: "open" as const, priority: 6 },
        { title: "ChangeItem types: code_deployment (links to ChangePromotion), infrastructure, configuration, external", type: "portfolio" as const, status: "open" as const, priority: 7 },
        { title: "Auto impact assessment on RFC submission using EP-FOUND-OPS impact API", type: "portfolio" as const, status: "open" as const, priority: 8 },
        { title: "Risk level auto-calculation from impact report dimensions", type: "portfolio" as const, status: "open" as const, priority: 9 },
        { title: "Deployment window calculation engine (business hours, blackouts, storefront traffic, booking density)", type: "portfolio" as const, status: "open" as const, priority: 10 },
        { title: "CalendarEvent creation on RFC approval with configurable stakeholder visibility", type: "portfolio" as const, status: "open" as const, priority: 11 },
        { title: "Booking block during maintenance window via ProviderAvailability override", type: "portfolio" as const, status: "open" as const, priority: 12 },
        { title: "Platform status banner API for active maintenance windows", type: "portfolio" as const, status: "open" as const, priority: 13 },
        { title: "Post-change health probe verification with results attached to RFC", type: "portfolio" as const, status: "open" as const, priority: 14 },
        { title: "StandardChangeCatalog model with pre-assessed templates and governance", type: "portfolio" as const, status: "open" as const, priority: 15 },
        { title: "/ops/changes route with Active, Calendar, History, Catalog, Windows tabs", type: "portfolio" as const, status: "open" as const, priority: 16 },
        { title: "RFC detail view with impact visualization, approval chain, timeline, post-change results", type: "portfolio" as const, status: "open" as const, priority: 17 },
        { title: "Business profile and deployment window configuration UI", type: "portfolio" as const, status: "open" as const, priority: 18 },
      ],
    },
    {
      epicId: "EP-EA-DP",
      title: "Digital Product as EA First-Class Citizen",
      description:
        "Extend EA modeling layer with Digital Product as a cross-layer element type in a new product domain. Bridge conceptual EA views to operational reality via health overlay and drill-through navigation. New viewpoints: Product Landscape (all products across portfolios), Product Dependency (single product dependencies), Change Impact (RFC overlay on product landscape). Standards-aware ArchiMate interchange with stereotype annotation.",
      status: "open" as const,
      portfolioSlugs: ["manufacturing_and_delivery"],
      stories: [
        { title: "digital-product EaElementType seed with product domain and cross-layer relationship rules", type: "portfolio" as const, status: "open" as const, priority: 1 },
        { title: "EA element creation for digital-product type with auto-link to DigitalProduct record", type: "portfolio" as const, status: "open" as const, priority: 2 },
        { title: "Lifecycle sync from DigitalProduct to linked EaElement (stage and status)", type: "portfolio" as const, status: "open" as const, priority: 3 },
        { title: "Health overlay on EA views via infraCiKey → HealthSnapshot status resolution", type: "portfolio" as const, status: "open" as const, priority: 4 },
        { title: "Health overlay toggle control in EA Modeler canvas", type: "portfolio" as const, status: "open" as const, priority: 5 },
        { title: "Drill-through: EA element → product detail or operational graph", type: "portfolio" as const, status: "open" as const, priority: 6 },
        { title: "Drill-through: operational graph entity → EA view (reverse navigation)", type: "portfolio" as const, status: "open" as const, priority: 7 },
        { title: "Product Landscape viewpoint definition and scoped rendering (organization scope, portfolio grouping)", type: "portfolio" as const, status: "open" as const, priority: 8 },
        { title: "Product Dependency viewpoint (single product scope, hierarchical layout, dependency traversal)", type: "portfolio" as const, status: "open" as const, priority: 9 },
        { title: "Change Impact viewpoint (RFC-scoped overlay, blast radius highlighting)", type: "portfolio" as const, status: "open" as const, priority: 10 },
        { title: "ArchiMate interchange: digital-product → ApplicationComponent with <<DigitalProduct>> stereotype", type: "portfolio" as const, status: "open" as const, priority: 11 },
        { title: "ArchiMate import: recognize <<DigitalProduct>> stereotype and type as digital-product", type: "portfolio" as const, status: "open" as const, priority: 12 },
      ],
    },
    {
      epicId: "EP-ONTOLOGY",
      title: "Digital Product Unified Ontology",
      description:
        "Formal ontology specification unifying IT4IT value streams, CSDM entity relationships, ITIL v5 practices, and ArchiMate notation around Digital Product as the anchor entity. Includes AI agent identity model (workforce/operator/component aspects), standards gap register, cross-standard mapping tables, and evolution model. Living specification that evolves from implementation learnings and real-world deployments. Positions this platform as a reference implementation informing CSDM 6, ITIL v5 practice guides, and future ArchiMate extensions.",
      status: "open" as const,
      portfolioSlugs: ["foundational", "manufacturing_and_delivery"],
      stories: [
        { title: "Entity catalog formalization: anchor entity, portfolio/governance, lifecycle/change, infrastructure/ops, architecture, AI workforce", type: "portfolio" as const, status: "open" as const, priority: 1 },
        { title: "Relationship taxonomy with cardinality rules and lifecycle constraints", type: "portfolio" as const, status: "open" as const, priority: 2 },
        { title: "Cross-layer traversal validation: Portfolio→Product→Infrastructure→Health in single query", type: "portfolio" as const, status: "open" as const, priority: 3 },
        { title: "Two-attribute lifecycle model documentation with valid transitions per entity type", type: "portfolio" as const, status: "open" as const, priority: 4 },
        { title: "AI agent identity model: workforce entity, operator, product component aspects", type: "portfolio" as const, status: "open" as const, priority: 5 },
        { title: "Agent identity resolution rules and cross-aspect query patterns", type: "portfolio" as const, status: "open" as const, priority: 6 },
        { title: "Standards mapping tables: DPF → IT4IT → CSDM → ITIL → ArchiMate", type: "portfolio" as const, status: "open" as const, priority: 7 },
        { title: "Gap register: documented deviations from standards with rationale", type: "portfolio" as const, status: "open" as const, priority: 8 },
        { title: "Portfolio boundary rules formalization (cross-portfolio relationship constraints)", type: "portfolio" as const, status: "open" as const, priority: 9 },
        { title: "Evolution log structure and versioning process", type: "portfolio" as const, status: "open" as const, priority: 10 },
      ],
    },
    {
      epicId: "EP-FULL-OBS",
      title: "Full Observability Integration",
      description:
        "Future epic for deep observability beyond lightweight health probes. Docker stats API integration (real-time CPU/memory/network), database performance views (slow queries, lock contention, replication lag), application-level metrics (request rates, error rates, latency percentiles), custom dashboard builder, external notification channels (email, webhook, Slack), distributed tracing, and log aggregation. Triggers when operational complexity outgrows the health probe model from EP-FOUND-OPS.",
      status: "open" as const,
      portfolioSlugs: ["foundational"],
      stories: [
        { title: "Docker stats API integration for real-time container resource metrics", type: "portfolio" as const, status: "open" as const, priority: 1 },
        { title: "Database performance views: slow queries, lock contention, replication lag", type: "portfolio" as const, status: "open" as const, priority: 2 },
        { title: "Application-level metrics collection: request rates, error rates, latency percentiles", type: "portfolio" as const, status: "open" as const, priority: 3 },
        { title: "External notification channels: email, webhook, Slack, PagerDuty", type: "portfolio" as const, status: "open" as const, priority: 4 },
        { title: "Custom operational dashboard builder (platform-native views)", type: "portfolio" as const, status: "open" as const, priority: 5 },
        { title: "Historical traffic pattern analysis for storefront deployment window optimization", type: "portfolio" as const, status: "open" as const, priority: 6 },
      ],
    },
  ];

  // 3. Upsert each epic + link portfolios + create stories
  for (const epicDef of epics) {
    // Check if epic already exists
    const existing = await prisma.epic.findFirst({
      where: { title: epicDef.title },
    });
    if (existing) {
      console.log(`  ⏭  Epic already exists: ${epicDef.title} (${existing.epicId})`);
      continue;
    }

    const epic = await prisma.epic.create({
      data: {
        epicId: epicDef.epicId,
        title: epicDef.title,
        description: epicDef.description,
        status: epicDef.status,
      },
    });
    console.log(`  ✅ Created epic: ${epic.title} (${epic.epicId})`);

    // Link portfolios
    for (const slug of epicDef.portfolioSlugs) {
      const portfolio = bySlug[slug];
      if (!portfolio) {
        console.log(`    ⚠️  Portfolio ${slug} not found, skipping link`);
        continue;
      }
      await prisma.epicPortfolio.create({
        data: { epicId: epic.id, portfolioId: portfolio.id },
      });
      console.log(`    📎 Linked to portfolio: ${slug}`);
    }

    // Create backlog items (stories)
    for (const story of epicDef.stories) {
      await prisma.backlogItem.create({
        data: {
          itemId: `${epicDef.epicId}-${String(story.priority).padStart(3, "0")}`,
          title: story.title,
          type: story.type,
          status: story.status,
          priority: story.priority,
          epicId: epic.id,
          source: "spec",
        },
      });
    }
    console.log(`    📋 Created ${epicDef.stories.length} backlog items`);
  }

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
