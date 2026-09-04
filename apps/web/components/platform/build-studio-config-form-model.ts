import type { BuildStudioDispatchConfig } from "@/lib/build/build-studio-config";
import type { ContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import type { EngineReadinessBadge, ProviderOption } from "./BuildStudioProviderControls";

export type BuildStudioConfigFormProps = {
  config: BuildStudioDispatchConfig;
  claudeProviders: ProviderOption[];
  codexProviders: ProviderOption[];
  grokProviders: ProviderOption[];
  opencodeProviders: ProviderOption[];
  contributorMcpReadiness: ContributorMcpReadiness;
  engineReadiness?: Record<string, EngineReadinessBadge>;
  baseUrl: string;
  canWrite: boolean;
};

export const CLAUDE_MODELS = [
  { value: "haiku", label: "Haiku", desc: "fastest, cheapest" },
  { value: "sonnet", label: "Sonnet", desc: "best balance", recommended: true },
  { value: "opus", label: "Opus", desc: "most capable, slower" },
];

export function describeOpenCodeProvider(providerId: string, providers: ProviderOption[]) {
  const selected = providers.find((provider) => provider.providerId === providerId) ?? providers[0];
  const selectedId = selected?.providerId ?? providerId;
  const isLocal = selectedId === "local" || selectedId === "ollama" || selectedId === "";
  const providerName = selected?.name ?? "OpenCode";
  return {
    label: isLocal ? "Local model (OpenCode) (Preview)" : `${providerName} (OpenCode) (Preview)`,
    desc: isLocal
      ? "Your own local LLM · no credential, runs offline"
      : `${providerName} via OpenCode · uses inherited provider credentials`,
    isLocal,
    providerName,
  };
}

export function shouldShowPinnedEngineMissingWarning(input: {
  enginePolicy: "auto" | "pinned";
  provider: string;
  probing: boolean;
  present: boolean | null | undefined;
}): boolean {
  return input.enginePolicy === "pinned"
    && ["claude", "codex", "grok", "opencode"].includes(input.provider)
    && !input.probing
    && input.present === false;
}

/**
 * Keep the owner-facing readiness line stable and legible. The routing reason is
 * diagnostic evidence: it can contain task-type, sensitivity, endpoint counts,
 * and provider identifiers, and its wording changes as the candidate pool does.
 * Build Studio retains that evidence on `config.selection`; the first viewport
 * answers only whether the resolved engine is ready under the current contract.
 */
export function describeBuildEngineSelection(
  selection: BuildStudioDispatchConfig["selection"],
): string {
  if (!selection) return "Selection updates from live readiness evidence.";
  return selection.status === "selected"
    ? "Ready under current routing and policy."
    : "No engine currently meets readiness and policy.";
}
