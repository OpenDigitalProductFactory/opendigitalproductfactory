// Backlog reconciliation: seed all epics that specs reference but the backlog is missing.
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-backlog-reconciliation.ts
//
// Context: 2026-03-21 audit found 29 specs with epic IDs never seeded into the database.
// This script creates those epics with deterministic IDs so specs → epics are traceable.
// All operations are upserts — safe to re-run.

import { prisma } from "../src/client";

// ── Epic definitions ────────────────────────────────────────────────────────

interface EpicDef {
  epicId: string;
  title: string;
  description: string;
  status: "done" | "in-progress" | "open";
  portfolioSlugs: string[];
  spec: string; // path relative to docs/superpowers/specs/
}

const epics: EpicDef[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // DONE — completed work that was never tracked in the backlog
  // ═══════════════════════════════════════════════════════════════════════════

  {
    epicId: "EP-CRM-001",
    title: "CRM Core",
    description:
      "Customer account lifecycle, contacts, orders, subscriptions, taxonomy linking. " +
      "Superseded by EP-CRM-SALES-001 which added the full sales pipeline.",
    status: "done",
    portfolioSlugs: ["products_and_services_sold"],
    spec: "2026-03-20-crm-research-synthesis.md",
  },
  {
    epicId: "EP-CRM-SALES-001",
    title: "CRM Sales Pipeline & Quote-to-Order",
    description:
      "Lead→Opportunity→Quote→SalesOrder pipeline. 12 backlog items. " +
      "Prisma models: Opportunity, Quote, QuoteLineItem, SalesOrder, Activity, Engagement.",
    status: "done",
    portfolioSlugs: ["products_and_services_sold"],
    spec: "2026-03-20-crm-sales-pipeline-design.md",
  },
  {
    epicId: "EP-AUTH-001",
    title: "Social Identity Sign-In for Customers",
    description:
      "Google/GitHub OAuth sign-in for storefront customers via NextAuth. " +
      "Customer-scoped sessions separate from employee/admin sessions.",
    status: "done",
    portfolioSlugs: ["products_and_services_sold", "foundational"],
    spec: "2026-03-19-social-identity-signin-design.md",
  },
  {
    epicId: "EP-SELF-DEV-003",
    title: "Sandbox Execution & Database Isolation",
    description:
      "Isolated sandbox schema for Build Studio code execution. " +
      "Per-build Prisma client, schema migration, teardown. Prevents sandbox code from touching production data.",
    status: "done",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-19-sandbox-execution-db-isolation-design.md",
  },
  {
    epicId: "EP-INF-008",
    title: "Specialized Model Capabilities",
    description:
      "Umbrella epic for execution adapters, tool-based capabilities, capability detection, and agent routing surface. " +
      "Sub-epics: EP-INF-008a (adapter framework), EP-INF-008b (tool capabilities), EP-INF-008b-ext (capability detection).",
    status: "done",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-20-specialized-model-capabilities-design.md",
  },
  {
    epicId: "EP-OPS-FILTER-001",
    title: "Backlog Hide Done Filter",
    description: "Filter to hide completed items in the backlog panel. Quick UX improvement.",
    status: "done",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-16-backlog-hide-done-filter-design.md",
  },
  {
    epicId: "EP-OPS-PANEL-001",
    title: "Backlog Panel Centered Modal",
    description: "Centered modal layout for backlog item detail/edit instead of side panel.",
    status: "done",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-16-backlog-panel-centered-modal-design.md",
  },
  {
    epicId: "EP-REG-DORA-001",
    title: "DORA Regulation Onboarding Dogfood",
    description:
      "End-to-end onboarding of DORA (EU 2022/2554) as first regulation in the compliance platform. " +
      "Identified 12 UI gaps, validated schema completeness, created DORA backlog items.",
    status: "done",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-18-dora-dogfood-results.md",
  },
  {
    epicId: "EP-GRC-001",
    title: "Compliance Engine Core",
    description:
      "Universal compliance engine: Regulation, Obligation, Control, Evidence, RiskAssessment, " +
      "ComplianceIncident, CorrectiveAction, ComplianceAuditLog models. 38 server actions, 24 UI pages.",
    status: "done",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-17-compliance-engine-core-design.md",
  },
  {
    epicId: "EP-POL-001",
    title: "Internal Policy Management",
    description:
      "Policy model with lifecycle (draft→active→retired), version tracking, obligation linking, " +
      "approval workflow. PolicyVersion, PolicyApproval models.",
    status: "done",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-17-internal-policy-management-design.md",
  },
  {
    epicId: "EP-GRC-002",
    title: "Regulatory Intelligence",
    description:
      "AI-powered regulatory monitoring agent. Watches for regulatory changes, " +
      "assesses impact on existing obligations, alerts compliance officers.",
    status: "done",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-18-regulatory-intelligence-design.md",
  },
  {
    epicId: "EP-GRC-003",
    title: "Reporting & Submissions",
    description:
      "Compliance reporting framework: report templates, submission tracking, " +
      "evidence compilation, regulatory filing management.",
    status: "done",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-18-reporting-submissions-design.md",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IN-PROGRESS — partially implemented
  // ═══════════════════════════════════════════════════════════════════════════

  {
    epicId: "EP-SELF-DEV-001",
    title: "Build Studio & Sandbox Execution",
    description:
      "Product Development Studio with sandboxed code generation. 5-phase pipeline " +
      "(Ideate→Plan→Build→Review→Ship). AI coding agent, sandbox file system, conversation integration.",
    status: "in-progress",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-14-self-dev-sandbox-design.md",
  },
  {
    epicId: "EP-SELF-DEV-002",
    title: "Self-Development Process Fix",
    description:
      "Fix 7 failure modes in Build Studio (repeated questions, zero actions, narrated code, " +
      "fabricated completion/deployment). Root causes: missing execution authority, conversation-only model, " +
      "no ground truth verification.",
    status: "in-progress",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-18-self-dev-process-fix-design.md",
  },
  {
    epicId: "EP-STORE-003",
    title: "Storefront Booking Calendar",
    description:
      "Availability model, slot computation, scheduling patterns for booking-enabled storefronts. " +
      "ProviderSchedule, ScheduleException, BookingSlot models. Multi-provider conflict detection.",
    status: "in-progress",
    portfolioSlugs: ["products_and_services_sold"],
    spec: "2026-03-20-storefront-booking-calendar-design.md",
  },
  {
    epicId: "EP-OPS-TRACE-001",
    title: "Backlog & Epic Traceability Fields",
    description:
      "Add submittedById, completedAt, claimedBy fields to BacklogItem and Epic. " +
      "Enable evidence trail for who submitted, completed, and is working on each item.",
    status: "in-progress",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-16-backlog-traceability-fields-design.md",
  },
  {
    epicId: "EP-INF-009",
    title: "Routing Hardening & Activation",
    description:
      "Post-adapter-framework hardening wave. Sub-epics: EP-INF-009b (legacy failover retirement), " +
      "EP-INF-009c (alternate endpoint adapters — image/audio/embedding), " +
      "EP-INF-009d (async/long-running models — Deep Research). 009b and 009c complete.",
    status: "in-progress",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-20-specialized-model-capabilities-design.md",
  },
  {
    epicId: "EP-OAUTH-001",
    title: "Generic OAuth Authorization Code Flow",
    description:
      "OAuth 2.0 authorization code + PKCE as generic auth method for AI providers. " +
      "OpenAI Codex as first consumer. Schema: OAuthPendingFlow, CredentialEntry.refreshToken.",
    status: "done",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-21-provider-oauth-authorization-code-design.md",
  },
  {
    epicId: "EP-GRC-ONBOARD",
    title: "Regulation & Standards Onboarding",
    description:
      "Generic onboarding process for any regulation, standard, or framework. " +
      "4-step wizard, AI coworker entry point, sourceType extension (external/standard/framework/internal), " +
      "policy-obligation many-to-many, and critical UI enhancements.",
    status: "in-progress",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-21-grc-onboarding-design.md",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OPEN — designed but not yet started
  // ═══════════════════════════════════════════════════════════════════════════

  {
    epicId: "EP-INF-010",
    title: "Platform Services UX",
    description:
      "Refactor provider management UI for the new service taxonomy. 4-section grid (LLM/Agent/Service/MCP), " +
      "recipe visibility, OAuth connection status, non-chat capability badges, async operations panel, " +
      "activated MCP service cards with health + tool counts, tool inventory panel showing all agent-facing tools. " +
      "Unifies provider routing admin (EP-INF-003–009) with MCP tool routing admin (EP-INT-001, EP-MCP-ACT-001). " +
      "Pure UI — all backend data exists.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-21-platform-services-ux-design.md",
  },
  {
    epicId: "EP-SELF-DEV-004",
    title: "Build Disciplines — Quality Gates for Self-Development",
    description:
      "Enforce Superpowers-equivalent development quality gates in Build Studio. " +
      "Research→spec→plan→build→test→review lifecycle for non-developer users.",
    status: "open",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-17-build-disciplines-design.md",
  },
  {
    epicId: "EP-UPLOAD-001",
    title: "File Upload & Document Parsing for Build Studio",
    description:
      "PDF/image upload with text extraction for Build Studio context. " +
      "In-memory parsing, no persistent file storage for licensing reasons.",
    status: "open",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-15-file-upload-document-parsing-design.md",
  },
  {
    epicId: "EP-INTAKE-001",
    title: "Portfolio-Aware Feature Intake",
    description:
      "Feature request intake that routes to the correct portfolio and taxonomy node. " +
      "AI-assisted categorization, duplicate detection, priority suggestion.",
    status: "open",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-15-portfolio-aware-intake-design.md",
  },
  {
    epicId: "EP-PROCESS-001",
    title: "Process Improvement AI Observer",
    description:
      "AI agent that observes platform usage patterns and suggests process improvements. " +
      "Bottleneck detection, workflow optimization recommendations.",
    status: "open",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-15-process-observer-design.md",
  },
  {
    epicId: "EP-QUALITY-001",
    title: "Product Quality Feedback & Error Reporting",
    description:
      "In-app quality feedback mechanism for digital products. Error reporting, " +
      "user satisfaction tracking, feedback-to-backlog pipeline.",
    status: "open",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-14-quality-feedback-design.md",
  },
  {
    epicId: "EP-BRANDING-001",
    title: "Branding Workflow Redesign",
    description:
      "Streamlined branding workflow: wizard-first approach, preview panel, " +
      "AI-assisted color/typography suggestions, brand consistency scoring.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-16-branding-workflow-redesign-design.md",
  },
  {
    epicId: "EP-FEEDBACK-001",
    title: "Platform Improvement Feedback Loop",
    description:
      "Structured feedback collection from all user roles. Issue→backlog pipeline, " +
      "trend analysis, satisfaction tracking. Closes the loop between users and platform development.",
    status: "open",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-16-platform-feedback-loop-design.md",
  },
  {
    epicId: "EP-ASYNC-001",
    title: "Asynchronous AI Agent Operations",
    description:
      "Background task execution for AI agents. Job queue, progress tracking, " +
      "notification on completion. Enables long-running agent tasks without blocking the UI.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-16-async-agent-operations-design.md",
  },
  {
    epicId: "EP-HR-FULL-001",
    title: "Full HR Lifecycle Management",
    description:
      "Complete HR lifecycle: recruitment, onboarding, performance reviews, " +
      "training, offboarding. Extends the HR Core foundation.",
    status: "open",
    portfolioSlugs: ["for_employees"],
    spec: "2026-03-16-hr-full-lifecycle-design.md",
  },
  {
    epicId: "EP-MEMORY-001",
    title: "Shared Agent Memory with Vector Database",
    description:
      "Persistent memory layer for AI agents using Qdrant vector database. " +
      "Cross-session context, knowledge accumulation, semantic retrieval.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-17-shared-memory-vector-db-design.md",
  },
  {
    epicId: "EP-AGENT-CAP-001",
    title: "Knowledge-Driven Agent Capabilities",
    description:
      "Dynamic agent skill acquisition from knowledge base. Agents learn new capabilities " +
      "from documentation, examples, and feedback rather than hard-coded tool definitions.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-18-knowledge-driven-agent-capabilities-design.md",
  },
  {
    epicId: "EP-AGENT-EXEC-002",
    title: "Structured Tool-Calling Protocol for Agentic Loop",
    description:
      "Formal protocol for tool calling in the agentic loop. Schema validation, " +
      "error recovery, retry policies, tool capability negotiation.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-18-structured-tool-calling-design.md",
  },
  {
    epicId: "EP-REF-001",
    title: "Reference Data & UX Polish",
    description:
      "UX improvements for reference data management screens. Inline editing, " +
      "bulk operations, search/filter, import/export.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-17-reference-data-ux-polish-design.md",
  },
  {
    epicId: "EP-INT-001",
    title: "MCP Integrations Catalog",
    description:
      "Browsable catalog of available MCP server integrations. One-click activation, " +
      "configuration wizard, health monitoring, usage analytics.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-19-mcp-integrations-catalog-design.md",
  },
  {
    epicId: "EP-UX-STANDARDS",
    title: "Platform-Wide UI/UX Usability Standards",
    description:
      "Systematic UX audit framework: WCAG compliance, color contrast, " +
      "component consistency, visual regression testing, design token enforcement.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-20-ux-usability-standards-design.md",
  },
  {
    epicId: "EP-UX-BUILD",
    title: "Build Studio UX Streamlining",
    description:
      "UX evaluation skill for AI coworker, Build Studio usability standards integration, " +
      "automated evidence chain for non-developer users, Dev toggle tiering.",
    status: "open",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-20-build-studio-ux-streamlining-design.md",
  },
  {
    epicId: "EP-DEV-LIFECYCLE-001",
    title: "Development Lifecycle Architecture",
    description:
      "Git integration for Build Studio: commit on approval, semantic versioning tied to git tags, " +
      "dev→staging→production promotion pipeline, change management approval workflow.",
    status: "open",
    portfolioSlugs: ["manufacturing_and_delivery"],
    spec: "2026-03-17-development-lifecycle-architecture-design.md",
  },
  {
    epicId: "EP-WINDOWS-INSTALLER",
    title: "Windows One-Click Installer",
    description:
      "Zero-prerequisites Windows installer (PowerShell script) for non-technical users. " +
      "Auto-installs Docker Desktop, WSL2, configures GPU passthrough, seeds data, opens browser.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-14-windows-installer-design.md",
  },
  {
    epicId: "EP-PRISMA-UPGRADE",
    title: "Prisma 5→7 Upgrade",
    description:
      "Upgrade Prisma from 5.22.0 to ^7.5.0. New generator provider, driver-adapter client, " +
      "prisma.config.ts. Eliminates global/local version skew.",
    status: "open",
    portfolioSlugs: ["foundational"],
    spec: "2026-03-18-prisma-7-upgrade-design.md",
  },
  {
    epicId: "EP-DOCS-001",
    title: "Platform Documentation System",
    description:
      "In-app user-facing documentation for all platform areas. File-based markdown in docs/user-guide/, " +
      "rendered under /(shell)/docs/ with sidebar navigation, search, contextual help links, and AI coworker integration. " +
      "Versioned content with lastUpdated tracking. Maintenance process tied to spec/feature lifecycle.",
    status: "open",
    portfolioSlugs: ["foundational", "products_and_services_sold"],
    spec: "2026-03-21-platform-documentation-system-design.md",
  },
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Backlog Reconciliation: seeding missing epics ===\n");

  // Load portfolios
  const portfolios = await prisma.portfolio.findMany({
    select: { id: true, slug: true },
  });
  const bySlug = Object.fromEntries(portfolios.map((p) => [p.slug, p.id]));
  console.log("Portfolios:", Object.keys(bySlug).join(", "));

  let created = 0;
  let updated = 0;

  for (const def of epics) {
    // Check if a random-ID epic with this exact title already exists
    const existingByTitle = await prisma.epic.findFirst({
      where: { title: def.title },
    });

    let epic;
    if (existingByTitle && existingByTitle.epicId !== def.epicId) {
      // Update the existing epic to use our deterministic ID
      epic = await prisma.epic.update({
        where: { id: existingByTitle.id },
        data: {
          epicId: def.epicId,
          description: def.description,
          status: def.status,
          ...(def.status === "done" ? { completedAt: new Date() } : {}),
        },
      });
      console.log(`  ↻ ${def.epicId}: "${def.title}" (updated random ID → deterministic)`);
      updated++;
    } else {
      epic = await prisma.epic.upsert({
        where: { epicId: def.epicId },
        update: {
          title: def.title,
          description: def.description,
          status: def.status,
          ...(def.status === "done" ? { completedAt: new Date() } : {}),
        },
        create: {
          epicId: def.epicId,
          title: def.title,
          description: def.description,
          status: def.status,
          ...(def.status === "done" ? { completedAt: new Date() } : {}),
        },
      });
      if (existingByTitle) {
        console.log(`  ✓ ${def.epicId}: "${def.title}" (already exists)`);
      } else {
        console.log(`  + ${def.epicId}: "${def.title}" (created)`);
        created++;
      }
    }

    // Link to portfolios
    for (const slug of def.portfolioSlugs) {
      const portfolioId = bySlug[slug];
      if (!portfolioId) {
        console.log(`    ⚠ Portfolio "${slug}" not found — skipping link`);
        continue;
      }
      await prisma.epicPortfolio.upsert({
        where: { epicId_portfolioId: { epicId: epic.id, portfolioId } },
        update: {},
        create: { epicId: epic.id, portfolioId },
      });
    }
  }

  console.log(`\n=== Done. ${created} created, ${updated} updated, ${epics.length} total. ===`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
