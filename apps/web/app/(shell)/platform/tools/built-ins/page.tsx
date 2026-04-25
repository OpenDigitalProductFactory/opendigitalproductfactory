import { PlatformKeysPanel, PLATFORM_KEY_CONFIGS } from "@/components/admin/PlatformKeysPanel";
import { getBuiltInToolsOverview } from "@/lib/actions/built-in-tools";

const BRAVE_SEARCH_CONFIG = PLATFORM_KEY_CONFIGS.filter(
  (config) => config.key === "brave_search_api_key",
);

export default async function BuiltInToolsPage() {
  const { tools, keyData } = await getBuiltInToolsOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Built-in Tools</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          First-party platform tools that ship with DPF and may require operator configuration or external access policy.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{tool.name}</h2>
                <p className="mt-2 text-sm text-[var(--dpf-muted)]">{tool.description}</p>
              </div>
              <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
                {tool.model}
              </span>
            </div>

            <div className="mt-4 space-y-2 text-xs text-[var(--dpf-muted)]">
              <p>
                Capability: <span className="font-mono text-[var(--dpf-text)]">{tool.capability}</span>
              </p>
              <p>
                Configuration:{" "}
                <span className="text-[var(--dpf-text)]">
                  {tool.configKey ? (tool.configured ? "Configured" : "Needs setup") : "No dedicated key"}
                </span>
              </p>
            </div>
          </div>
        ))}
      </div>

      <PlatformKeysPanel
        keyData={keyData}
        configs={BRAVE_SEARCH_CONFIG}
        title="Built-in Tool Configuration"
        description="Configure built-in tool credentials here. Brave Search remains backed by the existing `brave_search_api_key` platform config."
      />
    </div>
  );
}
