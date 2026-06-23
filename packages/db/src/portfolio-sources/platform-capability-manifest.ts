// Authoritative manifest of THIS platform's own subsystems that perform
// Foundational and Manufacturing-&-Delivery work (BI-PORTCOV-P1; spec §4.4.1).
//
// Network discovery only finds local infrastructure, so the Manufacturing &
// Delivery portfolio is empty even though GitHub, Build Studio, scheduling, the
// self-upgrade pipeline, and the edge fleet ARE the platform's manufacture and
// delivery machinery. capability-registry.ts enumerates *customer-facing*
// capability modules, not these internal subsystems — so this manifest is the
// projector's first source (spec open-decision #5). It is small, fixed, and
// authoritative (each entry is a verified code path); the changing sources
// (integrations, SBOM, AI providers) get their own projectors.
//
// productIds are "cap-*" so they never collide with the "infra-*"/"dpf-*" rows
// in digital_product_registry.json. All entries are coverage=used (the platform
// runs on them).

import type { PortfolioCoverageStatus, PortfolioSlug } from "./types";

export interface PlatformCapabilityManifestEntry {
  productId: string;
  name: string;
  description: string;
  portfolioSlug: PortfolioSlug;
  /** Existing taxonomy nodeId, or null to place at the portfolio root. */
  taxonomyNodeId: string | null;
  coverageStatus: PortfolioCoverageStatus;
  /** Public productIds this capability depends on (BI-PORTPRIO-2 dependency edges). */
  dependsOn?: string[];
}

/** "foundational/platform_services" exists (seeded; used by dpf-meta). */
const PLATFORM_SERVICES_NODE = "foundational/platform_services";

export const PLATFORM_CAPABILITY_MANIFEST: readonly PlatformCapabilityManifestEntry[] = [
  // ── Manufacturing & Delivery — the factory machinery ───────────────────────
  {
    productId: "cap-build-studio",
    name: "Build Studio",
    description:
      "Autonomous code manufacture & delivery pipeline (ideate → plan → build → review → ship) run by specialist AI agents in isolated sandboxes. apps/web/lib/integrate/build-orchestrator.ts.",
    portfolioSlug: "manufacturing_and_delivery",
    taxonomyNodeId: null,
    coverageStatus: "used",
    dependsOn: ["cap-build-sandbox", "cap-local-ai-inference", "cap-github-delivery"],
  },
  {
    productId: "cap-github-delivery",
    name: "GitHub Delivery",
    description:
      "Source-control delivery of manufactured changes: branch, commit, PR, status and merge via the GitHub Git Data API with DCO enforcement. apps/web/lib/integrate/github-api-commit.ts.",
    portfolioSlug: "manufacturing_and_delivery",
    taxonomyNodeId: null,
    coverageStatus: "used",
  },
  {
    productId: "cap-self-upgrade",
    name: "Self-Upgrade & Deployment Pipeline",
    description:
      "Governed platform self-deployment: quiescence, recovery points, image rebuild/swap, health evidence and rollback. The only path that advances the live install (/ops/self-upgrade).",
    portfolioSlug: "manufacturing_and_delivery",
    taxonomyNodeId: null,
    coverageStatus: "used",
  },
  {
    productId: "cap-scheduling",
    name: "Scheduling & Job Orchestration",
    description:
      "Recurring job orchestration (discovery, research, marketing, maintenance, projection) driven from the canonical scheduled-jobs catalog with stagger + contention guards.",
    portfolioSlug: "manufacturing_and_delivery",
    taxonomyNodeId: null,
    coverageStatus: "used",
  },
  {
    productId: "cap-edge-fleet",
    name: "Edge Node Fleet",
    description:
      "Distributed edge-node workers that run discovery and build execution close to the customer estate, for remote/on-prem and air-gapped deployments. apps/web/lib/edge-node.",
    portfolioSlug: "manufacturing_and_delivery",
    taxonomyNodeId: null,
    coverageStatus: "used",
  },
  {
    productId: "cap-build-sandbox",
    name: "Build Sandbox Runtime",
    description:
      "Isolated container runtime that executes and verifies generated code (typecheck + tests + production build) before any change can ship. apps/web/lib/integrate/sandbox.",
    portfolioSlug: "manufacturing_and_delivery",
    taxonomyNodeId: null,
    coverageStatus: "used",
  },
  {
    productId: "cap-marketing-delivery",
    name: "Marketing Delivery Channels",
    description:
      "Outbound delivery of marketing and communications through governed channels (Postmark email, LinkedIn), kernel-vetoed for autonomous sends. apps/web/lib/marketing/channels.",
    portfolioSlug: "manufacturing_and_delivery",
    taxonomyNodeId: null,
    coverageStatus: "used",
  },
  // ── Foundational — the floor everything runs on ────────────────────────────
  {
    productId: "cap-local-ai-inference",
    name: "Local AI Inference",
    description:
      "On-premises LLM inference via Docker Model Runner (OpenAI-compatible /v1) — the compute floor for every agent and build, with no data egress. apps/web/lib/ai-inference.ts.",
    portfolioSlug: "foundational",
    taxonomyNodeId: PLATFORM_SERVICES_NODE,
    coverageStatus: "used",
  },
  {
    productId: "cap-mcp-plane",
    name: "MCP Tooling & Coordination Plane",
    description:
      "The Model Context Protocol JSON-RPC surface (/api/mcp/v1) that exposes governed backlog, capsule, evidence and portfolio tools to every internal and external agent.",
    portfolioSlug: "foundational",
    taxonomyNodeId: PLATFORM_SERVICES_NODE,
    coverageStatus: "used",
  },
] as const;
