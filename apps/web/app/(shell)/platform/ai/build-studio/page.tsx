// apps/web/app/(shell)/platform/ai/build-studio/page.tsx
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { headers } from "next/headers";
import { getProviders } from "@/lib/inference/ai-provider-data";
import { getBuildStudioConfig } from "@/lib/integrate/build-studio-config";
import { getContributorMcpReadiness, type ContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import {
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
  getMcpTokenTemplate,
} from "@/lib/mcp-token-scopes";
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

  const [allProviders, config, contributorMcpReadiness] = await Promise.all([
    getProviders(),
    getBuildStudioConfig(),
    user
      ? getContributorMcpReadiness(user.id, { probe: false, baseUrl })
      : Promise.resolve(unauthenticatedReadiness()),
  ]);

  // Dynamic: group providers by cliEngine field instead of hardcoded IDs
  const claudeProviders = allProviders.filter(p =>
    (p.provider as Record<string, unknown>).cliEngine === "claude",
  );
  const codexProviders = allProviders.filter(p =>
    (p.provider as Record<string, unknown>).cliEngine === "codex",
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
        <Link
          href={BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioHref}
          className="inline-flex items-center rounded-lg bg-[var(--dpf-accent)] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          {BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioLabel}
        </Link>
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
        contributorMcpReadiness={contributorMcpReadiness}
        baseUrl={baseUrl}
        canWrite={canWrite}
      />
    </div>
  );
}
