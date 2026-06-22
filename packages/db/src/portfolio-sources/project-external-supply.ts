// External supply projectors (BI-PORTCOV-P2; spec §4.4.2/4.4.3): the AI provider
// registry and the supported business integrations, projected into the portfolios
// with the active/available/potential coverage axis.
//
// Both are GLOBAL (the install holds one ModelProvider registry and one
// IntegrationCredential set — IntegrationCredential has no organizationId), so
// they run in the seed alongside the platform-capability projector. They reuse
// the projectPortfolioEntries writer (idempotent, non-destructive).

import { prisma } from "../client";
import {
  projectPortfolioEntries,
  type ProjectPortfolioClient,
  type ProjectPortfolioResult,
} from "./project-portfolio-source";
import { SUPPORTED_INTEGRATIONS } from "./supported-integrations-manifest";
import type { ProjectedPortfolioEntry } from "./types";

/** "foundational/platform_services" exists (seeded; used by dpf-meta). */
const PLATFORM_SERVICES_NODE = "foundational/platform_services";

// ── AI provider registry → Foundational ──────────────────────────────────────

export type ProjectAiProvidersClient = ProjectPortfolioClient & {
  modelProvider: { findMany: (args: unknown) => Promise<unknown> };
};

type ProviderRow = {
  providerId: string;
  name: string;
  status: string;
  category: string | null;
  costBand: string | null;
  catalogVisibility: string | null;
};

/**
 * Project the configured + catalogued AI providers as Foundational compute
 * supply. Configured providers (e.g. local Docker Model Runner) are `used`;
 * catalogued-but-unconfigured providers (e.g. cloud LLMs) are `potential`.
 */
export async function projectAiProviders(
  options: { db?: ProjectAiProvidersClient } = {},
): Promise<ProjectPortfolioResult> {
  const db = options.db ?? (prisma as unknown as ProjectAiProvidersClient);

  const providers = (await db.modelProvider.findMany({
    select: {
      providerId: true,
      name: true,
      status: true,
      category: true,
      costBand: true,
      catalogVisibility: true,
    },
  })) as ProviderRow[];

  const entries: ProjectedPortfolioEntry[] = providers
    .filter((p) => p.catalogVisibility !== "hidden")
    .map((p) => ({
      productId: `prov-${p.providerId}`,
      name: p.name,
      description: `AI inference provider${p.category ? ` (${p.category})` : ""} — compute supply for agents and builds${p.costBand ? `; cost band ${p.costBand}` : ""}.`,
      portfolioSlug: "foundational" as const,
      taxonomyNodeId: PLATFORM_SERVICES_NODE,
      coverageStatus: p.status === "unconfigured" ? ("potential" as const) : ("used" as const),
      sourceKind: "ai_provider" as const,
    }));

  return projectPortfolioEntries(entries, { db });
}

// ── Supported business integrations → routed portfolios ──────────────────────

export type ProjectIntegrationsClient = ProjectPortfolioClient & {
  integrationCredential: { findMany: (args: unknown) => Promise<unknown> };
};

type CredentialRow = { provider: string; status: string };

/**
 * Project the supported business integrations. Coverage reflects connection
 * state: `used` when an IntegrationCredential is connected, `available` when a
 * credential row exists (any other status), `potential` when none does — the
 * "you could turn this on" planning view.
 */
export async function projectIntegrations(
  options: { db?: ProjectIntegrationsClient } = {},
): Promise<ProjectPortfolioResult> {
  const db = options.db ?? (prisma as unknown as ProjectIntegrationsClient);

  const credentials = (await db.integrationCredential.findMany({
    select: { provider: true, status: true },
  })) as CredentialRow[];
  const statusByProvider = new Map(credentials.map((c) => [c.provider, c.status]));

  const entries: ProjectedPortfolioEntry[] = SUPPORTED_INTEGRATIONS.map((integration) => {
    const status = statusByProvider.get(integration.credentialProvider);
    const coverageStatus =
      status === "connected"
        ? ("used" as const)
        : status
          ? ("available" as const)
          : ("potential" as const);
    return {
      productId: `int-${integration.slug}`,
      name: integration.name,
      description: `${integration.description} Integration (${integration.pricingModel}).`,
      portfolioSlug: integration.portfolioSlug,
      taxonomyNodeId: null,
      coverageStatus,
      sourceKind: "integration_registry" as const,
    };
  });

  return projectPortfolioEntries(entries, { db });
}
