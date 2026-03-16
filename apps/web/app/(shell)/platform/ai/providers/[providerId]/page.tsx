// apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProviderById, getProviders, getDiscoveredModels, getModelProfiles } from "@/lib/ai-provider-data";
import { ProviderDetailForm } from "@/components/platform/ProviderDetailForm";
import { getInfraCIs } from "@dpf/db";
import { OllamaHardwareInfo } from "@/components/platform/OllamaHardwareInfo";
import { OllamaManagement } from "@/components/platform/OllamaManagement";

type Props = { params: Promise<{ providerId: string }> };

export default async function ProviderDetailPage({ params }: Props) {
  const { providerId } = await params;
  const [pw, models, profiles, allProviders] = await Promise.all([
    getProviderById(providerId),
    getDiscoveredModels(providerId),
    getModelProfiles(providerId),
    getProviders(),
  ]);
  if (!pw) notFound();

  const hasActiveProvider = allProviders.some((p) => p.provider.status === "active");

  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections");

  // Fetch hardware info for Ollama
  let hardwareInfo: { gpu: string; vramGb: number | null; modelCount: number } | null = null;
  if (providerId === "ollama") {
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
        <Link href="/platform/ai/providers" style={{ color: "#b0b0c8", fontSize: 12 }}>← AI Providers</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "6px 0 2px" }}>{pw.provider.name}</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
          <span style={{ fontSize: 12, color: "#b0b0c8", fontFamily: "monospace" }}>{pw.provider.providerId}</span>
          {pw.provider.docsUrl && (
            <a href={pw.provider.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#7c8cf8", fontSize: 12 }}>
              Docs
            </a>
          )}
          {pw.provider.consoleUrl && (
            <a href={pw.provider.consoleUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#7c8cf8", fontSize: 12 }}>
              Console
            </a>
          )}
        </div>
      </div>

      {hardwareInfo && (
        <OllamaHardwareInfo
          gpu={hardwareInfo.gpu}
          vramGb={hardwareInfo.vramGb}
          modelCount={hardwareInfo.modelCount}
        />
      )}

      {providerId === "ollama" && (
        <OllamaManagement canWrite={canWrite} />
      )}

      {pw.provider.costPerformanceNotes && (
        <div style={{
          background: "#161625",
          borderLeft: "3px solid #7c8cf8",
          borderRadius: 6,
          padding: "12px 16px",
          marginBottom: 16,
          fontSize: 12,
          color: "#b0b0c8",
          lineHeight: 1.5,
        }}>
          {pw.provider.costPerformanceNotes}
        </div>
      )}

      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: 8, padding: 20 }}>
        <ProviderDetailForm pw={pw} canWrite={canWrite} models={models} profiles={profiles} hasActiveProvider={hasActiveProvider} />
      </div>
    </div>
  );
}
