// apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProviderById, getProviders, getDiscoveredModels, getModelProfiles, getRecipesForProvider, getModelClassCounts } from "@/lib/ai-provider-data";
import { ProviderDetailForm } from "@/components/platform/ProviderDetailForm";
import { getInfraCIs } from "@dpf/db";
import { getEndpointPerformance, getRoutingProfiles, getRecentRouteDecisions } from "@/lib/actions/endpoint-performance";
import EndpointPerformancePanel from "@/components/platform/EndpointPerformancePanel";
import RouteDecisionLog from "@/components/platform/RouteDecisionLog";
import { OllamaHardwareInfo } from "@/components/platform/OllamaHardwareInfo";
import { OllamaManagement } from "@/components/platform/OllamaManagement";
import { RecipePanel } from "@/components/platform/RecipePanel";
import { OAuthConnectionStatus } from "@/components/platform/OAuthConnectionStatus";
import { AiProviderFinancePanel } from "@/components/finance/AiProviderFinancePanel";
import { getAiProviderFinanceDetail } from "@/lib/finance/ai-provider-finance";

type Props = { params: Promise<{ providerId: string }> };

export default async function ProviderDetailPage({ params }: Props) {
  const { providerId } = await params;
  const [pw, models, profiles, allProviders, perfData, routingProfiles, routeDecisions, recipes, modelClassCounts, financeDetail] = await Promise.all([
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
  ]);
  if (!pw) notFound();

  const hasActiveProvider = allProviders.some((p) => p.provider.status === "active");

  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections");

  // Fetch hardware info for Ollama
  let hardwareInfo: { gpu: string; vramGb: number | null; modelCount: number } | null = null;
  if (providerId === "local" || providerId === "ollama") {
    const infraCIs = await getInfraCIs("ai-inference");
    const ollamaCI = infraCIs.find((ci) => ci.id === "CI-ollama-01");
    if (ollamaCI?.properties.gpu) {
      hardwareInfo = {
        gpu: ollamaCI.properties.gpu as string,
        vramGb: (ollamaCI.properties.vramGb as number) ?? null,
        modelCount: (ollamaCI.properties.modelCount as number) ?? 0,
      };
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
        <OllamaManagement canWrite={canWrite} />
      )}

      {pw.provider.costPerformanceNotes && (
        <div style={{
          background: "var(--dpf-surface-1)",
          borderLeft: "3px solid #7c8cf8",
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
        <McpServiceDetail provider={pw.provider} />
      ) : (
        <>
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
            <AiProviderFinancePanel detail={financeDetail} />
          </div>
          {/* Execution Recipes */}
          <RecipePanel recipes={recipes} />
        </>
      )}

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

function McpServiceDetail({ provider }: { provider: import("@/lib/ai-provider-types").ProviderRow }) {
  const isPluginManaged = provider.category === "mcp-subscribed" && !provider.endpoint && !provider.baseUrl;

  return (
    <div style={{ background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 20 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 16 }}>MCP Service Configuration</h2>

      {isPluginManaged && (
        <div style={{
          background: "var(--dpf-surface-1)",
          borderLeft: "3px solid #38bdf8",
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
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Endpoint Type</div>
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
          <div style={{ fontSize: 13, color: provider.status === "active" ? "#4ade80" : "#fbbf24" }}>{provider.status}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Capability Tier</div>
          <div style={{ fontSize: 13, color: "var(--dpf-text)" }}>{provider.capabilityTier ?? "basic"}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Cost Band</div>
          <div style={{ fontSize: 13, color: "var(--dpf-text)" }}>{provider.costBand ?? "free"}</div>
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
