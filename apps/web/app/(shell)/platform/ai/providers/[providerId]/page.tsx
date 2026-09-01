// apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProviderById, getProviders, getDiscoveredModels, getModelProfiles, getRecipesForProvider, getModelClassCounts, getTokenSpendByProvider } from "@/lib/ai-provider-data";
import { ProviderDetailForm } from "@/components/platform/ProviderDetailForm";
import { ProviderCostSourcePanel } from "@/components/platform/ProviderCostSourcePanel";
import { getInfraCIs, prisma } from "@dpf/db";
import { getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { getEndpointPerformance, getRoutingProfiles, getRecentRouteDecisions } from "@/lib/actions/endpoint-performance";
import EndpointPerformancePanel from "@/components/platform/EndpointPerformancePanel";
import RouteDecisionLog from "@/components/platform/RouteDecisionLog";
import { OllamaHardwareInfo } from "@/components/platform/OllamaHardwareInfo";
import { OllamaManagement } from "@/components/platform/OllamaManagement";
import { RecipePanel } from "@/components/platform/RecipePanel";
import { OAuthConnectionStatus } from "@/components/platform/OAuthConnectionStatus";
import { OAuthPortMismatchBanner } from "@/components/admin/OAuthPortMismatchBanner";
import { AiProviderFinancePanel } from "@/components/finance/AiProviderFinancePanel";
import { getAiProviderFinanceDetail } from "@/lib/finance/ai-provider-finance";
import { buildProviderCostView } from "@/lib/inference/ai-provider-cost-view";
import { ProviderAccountPostureForm } from "@/components/platform/ProviderAccountPostureForm";
import { ProviderTrustEvidencePanel } from "@/components/platform/ProviderTrustEvidencePanel";
import { resolveProviderTrustEvidence, type ProviderTrustClaimKey } from "@/lib/routing/provider-suitability/evidence";
import { connectionPosture } from "@/lib/routing/provider-suitability/provider-onboarding-data";
import { shouldShowProviderAccountPosture } from "@/components/platform/local-models/provider-detail-policy";

type Props = { params: Promise<{ providerId: string }> };

export default async function ProviderDetailPage({ params }: Props) {
  // Guard: this route has no middleware — data-fetching server actions enforce
  // requireViewAccess() and will throw if called unauthenticated, crashing the
  // Server Component render. Redirect early before any data fetching occurs.
  const earlySession = await auth();
  if (!earlySession?.user) redirect("/login");

  const { providerId } = await params;
  const now = new Date();
  const currentMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  // BI-2DD7042A: self-heal expired OAuth tokens on view. Token refresh is lazy —
  // getProviderBearerToken refreshes only when a dispatch actually uses the
  // provider — so a provider that sat idle or disabled lapses and this page used
  // to demand a sign-in the operator doesn't need. Attempt the refresh here,
  // BEFORE the cached data reads below, so the page renders the healed state.
  // Best-effort: a failed refresh marks the credential "expired" and the UI
  // falls back to the sign-in flow.
  const oauthPeek = await prisma.modelProvider.findUnique({
    where: { providerId },
    select: { authMethod: true },
  });
  if (oauthPeek?.authMethod === "oauth2_authorization_code") {
    const credPeek = await prisma.credentialEntry.findUnique({
      where: { providerId },
      select: { tokenExpiresAt: true, refreshToken: true },
    });
    if (credPeek?.refreshToken && credPeek.tokenExpiresAt && credPeek.tokenExpiresAt.getTime() <= now.getTime()) {
      await getProviderBearerToken(providerId).catch(() => null);
    }
  }
  const [pw, models, profiles, allProviders, perfData, routingProfiles, routeDecisions, recipes, modelClassCounts, financeDetail, tokenSpend, providerConnection] = await Promise.all([
    getProviderById(providerId),
    getDiscoveredModels(providerId),
    getModelProfiles(providerId),
    getProviders(),
    getEndpointPerformance(providerId),
    getRoutingProfiles(providerId),
    getRecentRouteDecisions(providerId),
    getRecipesForProvider(providerId),
    getModelClassCounts(providerId),
    getAiProviderFinanceDetail(providerId),
    getTokenSpendByProvider(currentMonth),
    prisma.aiProviderConnection.findUnique({
      where: { connectionId: `provider-default-${providerId}` },
      include: {
        trustEvidence: true,
        supplierContract: { select: { contractId: true, status: true, startDate: true, endDate: true } },
      },
    }),
  ]);
  if (!pw) notFound();
  const costView = buildProviderCostView({
    provider: pw.provider,
    financeProfile: financeDetail,
    internalUsage: tokenSpend.find((row) => row.providerId === providerId) ?? null,
  });
  const requiredEvidenceClaims: ProviderTrustClaimKey[] = providerId === "openrouter"
    ? ["no-training", "enabled-regions", "zero-retention", "regional-processing", "approved-underlying-providers", "dpa-on-file"]
    : ["no-training", "enabled-regions", "dpa-on-file"];
  const trustEvidenceResolution = providerConnection
    ? resolveProviderTrustEvidence({
      connection: connectionPosture(providerConnection),
      evidenceConnectionId: providerConnection.id,
      records: providerConnection.trustEvidence,
      requiredClaims: requiredEvidenceClaims,
      supplierContract: providerConnection.supplierContract ?? undefined,
      now,
    })
    : null;

  const hasActiveProvider = allProviders.some((p) => p.provider.status === "active");

  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections");
  const showPosture = shouldShowProviderAccountPosture(providerId, pw.provider.endpointType);

  // Fetch hardware info for local providers via Neo4j InfraCI.
  // Wrapped in try/catch — Neo4j is best-effort; a graph error must never crash the page.
  let hardwareInfo: { gpu: string; vramGb: number | null; modelCount: number } | null = null;
  if (providerId === "local" || providerId === "ollama") {
    try {
      const infraCIs = await getInfraCIs("ai-inference");
      const ollamaCI = infraCIs.find((ci) => ci.id === "CI-ollama-01");
      if (ollamaCI?.properties.gpu) {
        hardwareInfo = {
          gpu: String(ollamaCI.properties.gpu),
          vramGb: ollamaCI.properties.vramGb != null ? Number(ollamaCI.properties.vramGb) : null,
          modelCount: ollamaCI.properties.modelCount != null ? Number(ollamaCI.properties.modelCount) : 0,
        };
      }
    } catch {
      // Neo4j unavailable or returns unexpected data — hardware info degrades gracefully to null
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link href="/platform/ai/providers" style={{ color: "var(--dpf-muted)", fontSize: 12 }}>← External Services</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)", margin: "6px 0 2px" }}>{pw.provider.name}</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
          <span style={{ fontSize: 12, color: "var(--dpf-muted)", fontFamily: "monospace" }}>{pw.provider.providerId}</span>
          {pw.provider.docsUrl && (
            <a href={pw.provider.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--dpf-accent)", fontSize: 12 }}>
              Docs
            </a>
          )}
          {pw.provider.consoleUrl && (
            <a href={pw.provider.consoleUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--dpf-accent)", fontSize: 12 }}>
              Console
            </a>
          )}
        </div>
        {/* Capability summary */}
        {modelClassCounts.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 6 }}>
            Capabilities: {modelClassCounts.map((c, i) => (
              <span key={c.modelClass}>
                {i > 0 && " · "}
                {c.modelClass === "chat" ? "Chat" : c.modelClass === "reasoning" ? "Reasoning" : c.modelClass.replace("_", " ")}
                {" "}({c.count})
              </span>
            ))}
          </div>
        )}
      </div>

      {hardwareInfo && (
        <OllamaHardwareInfo
          gpu={hardwareInfo.gpu}
          vramGb={hardwareInfo.vramGb}
          modelCount={hardwareInfo.modelCount}
        />
      )}

      {(providerId === "local" || providerId === "ollama") && (
        <OllamaManagement
          canWrite={canWrite}
          vramGb={hardwareInfo?.vramGb ?? null}
          providerId={providerId}
        />
      )}

      {pw.provider.costPerformanceNotes && (
        <div style={{
          background: "var(--dpf-surface-1)",
          borderLeft: "3px solid var(--dpf-info)",
          borderRadius: 6,
          padding: "12px 16px",
          marginBottom: 16,
          fontSize: 12,
          color: "var(--dpf-muted)",
          lineHeight: 1.5,
        }}>
          {pw.provider.costPerformanceNotes}
        </div>
      )}

      {pw.provider.endpointType === "service" ? (
        <McpServiceDetail provider={pw.provider} connectionStatus={providerConnection?.status ?? null} />
      ) : showPosture ? (
        <>
          <ProviderAccountPostureForm
            providerId={providerId}
            canWrite={canWrite}
            initial={providerConnection ? {
              accountClass: providerConnection.accountClass,
              noTraining: providerConnection.entitlements && typeof providerConnection.entitlements === "object" && !Array.isArray(providerConnection.entitlements)
                ? (providerConnection.entitlements as Record<string, unknown>).noTraining === true
                  ? true
                  : (providerConnection.entitlements as Record<string, unknown>).noTraining === false
                    ? false
                    : null
                : null,
              enabledRegions: providerConnection.entitlements && typeof providerConnection.entitlements === "object" && !Array.isArray(providerConnection.entitlements) && Array.isArray((providerConnection.entitlements as Record<string, unknown>).enabledRegions)
                ? ((providerConnection.entitlements as Record<string, unknown>).enabledRegions as unknown[]).filter((region): region is string => typeof region === "string")
                : [],
              zeroRetention: providerConnection.entitlements && typeof providerConnection.entitlements === "object" && !Array.isArray(providerConnection.entitlements)
                ? typeof (providerConnection.entitlements as Record<string, unknown>).zeroRetention === "boolean"
                  ? (providerConnection.entitlements as Record<string, unknown>).zeroRetention as boolean
                  : null
                : null,
              regionalProcessing: providerConnection.entitlements && typeof providerConnection.entitlements === "object" && !Array.isArray(providerConnection.entitlements)
                ? typeof (providerConnection.entitlements as Record<string, unknown>).regionalProcessing === "boolean"
                  ? (providerConnection.entitlements as Record<string, unknown>).regionalProcessing as boolean
                  : null
                : null,
              approvedUnderlyingProviderSlugs: providerConnection.entitlements && typeof providerConnection.entitlements === "object" && !Array.isArray(providerConnection.entitlements) && Array.isArray((providerConnection.entitlements as Record<string, unknown>).approvedUnderlyingProviderSlugs)
                ? ((providerConnection.entitlements as Record<string, unknown>).approvedUnderlyingProviderSlugs as unknown[]).filter((slug): slug is string => typeof slug === "string")
                : [],
            } : null}
          />
          {trustEvidenceResolution && (
            <ProviderTrustEvidencePanel
              accountDeclarationSaved={Boolean(
                providerConnection?.lastReviewedAt
                && providerConnection.entitlements
                && typeof providerConnection.entitlements === "object"
                && !Array.isArray(providerConnection.entitlements)
                && ("noTraining" in providerConnection.entitlements || "enabledRegions" in providerConnection.entitlements)
              )}
              evidenceStatus={trustEvidenceResolution.posture.evidenceStatus}
              lastReviewedAt={trustEvidenceResolution.posture.lastReviewedAt}
              claims={trustEvidenceResolution.claims}
            />
          )}
          {/* BI-87D93A71 (Minimum): surface OAuth callback port mismatch
              BEFORE the user clicks Connect — eliminates the silent
              :3000 → :1455 origin divergence that the shared OpenAI
              Codex/ChatGPT OAuth client requires today. */}
          <OAuthPortMismatchBanner
            oauthRedirectUri={pw.provider.oauthRedirectUri ?? null}
            providerLabel={pw.provider.name ?? pw.provider.providerId}
          />
          {pw.credential && (
            <OAuthConnectionStatus
              credential={pw.credential}
              authMethod={pw.provider.authMethod}
              authorizeUrl={pw.provider.authorizeUrl ?? null}
              providerId={pw.provider.providerId}
            />
          )}
          <div style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 20 }}>
            <ProviderDetailForm pw={pw} canWrite={canWrite} models={models} profiles={profiles} hasActiveProvider={hasActiveProvider} routingProfiles={routingProfiles} />
          </div>
          <div style={{ marginTop: 16 }}>
            <ProviderCostSourcePanel view={costView} />
          </div>
          <div style={{ marginTop: 16 }}>
            <AiProviderFinancePanel detail={financeDetail} />
          </div>
          {/* Execution Recipes */}
          <RecipePanel recipes={recipes} />
        </>
      ) : null}

      <EndpointPerformancePanel
        endpointId={providerId}
        performances={perfData.performances}
        recentEvals={perfData.recentEvals}
        testRuns={perfData.testRuns}
        profile={perfData.profile}
      />

      {routeDecisions.length > 0 && (
        <RouteDecisionLog decisions={routeDecisions} />
      )}
    </div>
  );
}

function McpServiceDetail({ provider, connectionStatus }: { provider: import("@/lib/ai-provider-types").ProviderRow; connectionStatus?: string | null }) {
  const isPluginManaged = provider.category === "mcp-subscribed" && !provider.endpoint && !provider.baseUrl;

  return (
    <div style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 20 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 16 }}>MCP service</h2>

      {isPluginManaged && (
        <div style={{
          background: "var(--dpf-surface-1)",
          borderLeft: "3px solid var(--dpf-info)",
          borderRadius: 6,
          padding: "12px 16px",
          marginBottom: 16,
          fontSize: 12,
          color: "var(--dpf-muted)",
          lineHeight: 1.5,
        }}>
          This service is managed by a Claude Code plugin. Connection details are handled by the plugin runtime — no manual URL configuration needed.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Endpoint</div>
          <div style={{ fontSize: 13, color: "var(--dpf-text)" }}>{provider.endpointType}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Category</div>
          <div style={{ fontSize: 13, color: "var(--dpf-text)" }}>{provider.category}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Transport</div>
          <div style={{ fontSize: 13, color: "var(--dpf-text)" }}>{provider.mcpTransport ?? "Plugin-managed"}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Status</div>
          {/* BI-04E4F111: routing filters on the CONNECTION's status. A provider
              whose only connection is disabled must not read "active" here. */}
          {provider.status === "active" && connectionStatus === "disabled" ? (
            <div style={{ fontSize: 13, color: "var(--dpf-warning)" }}>
              connection disabled
              <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
                Routing skips this provider until you reconnect its credentials.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: provider.status === "active" ? "var(--dpf-success)" : "var(--dpf-warning)" }}>{provider.status}</div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Capability</div>
          <div style={{ fontSize: 13, color: "var(--dpf-text)" }}>{provider.capabilityTier ?? "basic"}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Cost</div>
          <div style={{ fontSize: 13, color: "var(--dpf-text)" }}>{provider.costBand || "unspecified"}</div>
        </div>
      </div>

      {/* Sensitivity Clearance */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Sensitivity Clearance</div>
        <div style={{ display: "flex", gap: 6 }}>
          {(provider.sensitivityClearance ?? []).length > 0
            ? (provider.sensitivityClearance ?? []).map((s: string) => (
                <span key={s} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--dpf-surface-1)", color: "var(--dpf-muted)" }}>{s}</span>
              ))
            : <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>None configured</span>
          }
        </div>
      </div>

      {/* Task Tags */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Task Tags</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(provider.taskTags ?? []).length > 0
            ? (provider.taskTags ?? []).map((tag: string) => (
                <span key={tag} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--dpf-surface-1)", color: "var(--dpf-muted)" }}>{tag}</span>
              ))
            : <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>None configured</span>
          }
        </div>
      </div>

      {/* Endpoint URL (if manually configured) */}
      {(provider.endpoint || provider.baseUrl) && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Endpoint URL</div>
          <div style={{ fontSize: 12, color: "var(--dpf-text)", fontFamily: "monospace" }}>{provider.endpoint ?? provider.baseUrl}</div>
        </div>
      )}
    </div>
  );
}
