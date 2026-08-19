// apps/web/app/(shell)/platform/ai/build-studio/page.tsx
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { headers } from "next/headers";
import { getProviders } from "@/lib/inference/ai-provider-data";
import { prisma } from "@dpf/db";
import { getBuildStudioConfig } from "@/lib/build/build-studio-config";
import { getContributorMcpReadiness, type ContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import {
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
  getMcpTokenTemplate,
} from "@/lib/mcp-token-scopes";
import { AiReadinessHeaderLink } from "@/components/platform/AiReadinessHeaderLink";
import { BuildStudioConfigForm } from "@/components/platform/BuildStudioConfigForm";
import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "@/components/platform/build-studio-route-copy";
import Link from "next/link";

function unauthenticatedReadiness(): ContributorMcpReadiness {
  const requiredGrants = [...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS];
  return {
    status: "needs_authorization",
    recommendedAction: "issue_development_token",
    identityBinding: "not_available",
    token: null,
    missingGrants: [...requiredGrants],
    requiredGrants,
    recommendedScopes: [...(getMcpTokenTemplate("development")?.grants ?? requiredGrants)],
    probe: { status: "not_run" },
  };
}

export default async function BuildStudioPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_provider_connections",
  );

  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const baseUrl = `${proto}://${host}`;

  const [allProviders, config, contributorMcpReadiness, engineStates] = await Promise.all([
    getProviders({ includeHidden: true }),
    getBuildStudioConfig(),
    user
      ? getContributorMcpReadiness(user.id, { probe: false })
      : Promise.resolve(unauthenticatedReadiness()),
    prisma.buildEngine.findMany({
      select: { engineId: true, state: { select: { present: true, version: true, lastProbedAt: true } } },
    }),
  ]);

  // Per-engine readiness from the last probe (BuildEngineState) — drives the
  // present/absent badge so an engine that is selectable but not actually
  // installed in the sandbox shows "not installed" instead of silently failing
  // at dispatch. Build-Engine Provisioning (EP-2D477458) Phase 1b.
  const engineReadiness: Record<
    string,
    { present: boolean | null; version: string | null; lastProbedAt: string | null }
  > = {};
  for (const e of engineStates) {
    engineReadiness[e.engineId] = {
      present: e.state?.present ?? null,
      version: e.state?.version ?? null,
      lastProbedAt: e.state?.lastProbedAt ? e.state.lastProbedAt.toISOString() : null,
    };
  }

  // Dynamic: group providers by cliEngine field instead of hardcoded IDs
  const claudeProviders = allProviders.filter(p =>
    (p.provider as Record<string, unknown>).cliEngine === "claude",
  );
  const codexProviders = allProviders.filter(p =>
    (p.provider as Record<string, unknown>).cliEngine === "codex",
  );
  const grokProviders = allProviders.filter(p =>
    (p.provider as Record<string, unknown>).cliEngine === "grok",
  );
  const opencodeProviders = allProviders.filter(p =>
    (p.provider as Record<string, unknown>).cliEngine === "opencode",
  );

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          {BUILD_STUDIO_CONFIG_ROUTE_COPY.title}
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          {BUILD_STUDIO_CONFIG_ROUTE_COPY.description}
        </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AiReadinessHeaderLink />
          <Link
            href={BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioHref}
            className="inline-flex items-center rounded-lg bg-[var(--dpf-accent)] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioLabel}
          </Link>
        </div>
      </div>

      <BuildStudioConfigForm
        config={config}
        claudeProviders={claudeProviders.map(p => ({
          providerId: p.provider.providerId,
          name: p.provider.name,
          status: p.credential?.status ?? "unconfigured",
          billingLabel: p.provider.billingLabel,
          costNotes: p.provider.costPerformanceNotes,
        }))}
        codexProviders={codexProviders.map(p => ({
          providerId: p.provider.providerId,
          name: p.provider.name,
          status: p.credential?.status ?? "unconfigured",
          billingLabel: p.provider.billingLabel,
          costNotes: p.provider.costPerformanceNotes,
        }))}
        grokProviders={grokProviders.map(p => ({
          providerId: p.provider.providerId,
          name: p.provider.name,
          status: p.credential?.status ?? "unconfigured",
          billingLabel: p.provider.billingLabel,
          costNotes: p.provider.costPerformanceNotes,
        }))}
        opencodeProviders={opencodeProviders.map(p => ({
          providerId: p.provider.providerId,
          name: p.provider.name,
          status: p.credential?.status ?? "unconfigured",
          billingLabel: p.provider.billingLabel,
          costNotes: p.provider.costPerformanceNotes,
        }))}
        contributorMcpReadiness={contributorMcpReadiness}
        engineReadiness={engineReadiness}
        baseUrl={baseUrl}
        canWrite={canWrite}
      />
    </div>
  );
}
