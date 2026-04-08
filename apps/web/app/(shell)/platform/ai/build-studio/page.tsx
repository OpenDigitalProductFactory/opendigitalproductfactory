// apps/web/app/(shell)/platform/ai/build-studio/page.tsx
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProviders } from "@/lib/inference/ai-provider-data";
import { getBuildStudioConfig } from "@/lib/integrate/build-studio-config";
import { AiTabNav } from "@/components/platform/AiTabNav";
import { BuildStudioConfigForm } from "@/components/platform/BuildStudioConfigForm";

const CLAUDE_PROVIDER_IDS = ["anthropic", "anthropic-sub"];
const CODEX_PROVIDER_IDS = ["codex", "chatgpt"];

export default async function BuildStudioPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_provider_connections",
  );

  const [allProviders, config] = await Promise.all([
    getProviders(),
    getBuildStudioConfig(),
  ]);

  const claudeProviders = allProviders.filter(p =>
    CLAUDE_PROVIDER_IDS.includes(p.provider.providerId),
  );
  const codexProviders = allProviders.filter(p =>
    CODEX_PROVIDER_IDS.includes(p.provider.providerId),
  );

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Build Studio
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Configure which CLI agent and credentials run build tasks in the sandbox.
        </p>
      </div>

      <AiTabNav />

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
        canWrite={canWrite}
      />
    </div>
  );
}
