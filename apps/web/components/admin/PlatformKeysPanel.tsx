"use client";

import { useState, useTransition } from "react";
import { savePlatformApiKey } from "@/lib/actions/ai-providers";

type KeyConfig = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  isSecret: boolean;
};

export const PLATFORM_KEY_CONFIGS: KeyConfig[] = [
  {
    key: "brave_search_api_key",
    label: "Brave Search API Key",
    description: "Enables the AI Coworker to search the web when External Access is on. Get a free key at brave.com/search/api.",
    placeholder: "BSA-xxxxxxxxxxxxxxxx",
    isSecret: true,
  },
  {
    key: "upload_storage_path",
    label: "File Upload Storage Path",
    description: "Directory for uploaded files. Use an absolute path in production (e.g., D:/dpf-uploads).",
    placeholder: "./data/uploads",
    isSecret: false,
  },
];

type KeyData = { configured: boolean; currentValue: string | null };

type Props = {
  keyData: Record<string, KeyData>;
  title?: string;
  description?: string;
  configs?: KeyConfig[];
};

function maskSecret(value: string): string {
  if (value.length <= 6) return "\u2022".repeat(value.length);
  return value.slice(0, 4) + "\u2022".repeat(Math.min(value.length - 4, 12));
}

export function PlatformKeysPanel({
  keyData,
  title = "Platform Settings",
  description = "External service keys and paths used by the platform.",
  configs = PLATFORM_KEY_CONFIGS,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});

  function handleSave(key: string) {
    const value = values[key];
    if (!value?.trim()) return;
    startTransition(async () => {
      await savePlatformApiKey(key, value.trim());
      setSavedValues((prev) => ({ ...prev, [key]: value.trim() }));
      setValues((prev) => ({ ...prev, [key]: "" }));
    });
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">{title}</h2>
      <p className="text-sm text-[var(--dpf-muted)] mb-4">{description}</p>

      <div className="space-y-3">
        {configs.map((cfg) => {
          const data = keyData[cfg.key];
          const displayValue = savedValues[cfg.key] ?? data?.currentValue ?? null;
          const isConfigured = !!displayValue;
          const statusColor = isConfigured ? "var(--dpf-success)" : "var(--dpf-warning)";

          return (
            <div
              key={cfg.key}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: statusColor }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-[var(--dpf-text)]">{cfg.label}</span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: `color-mix(in srgb, ${statusColor} 13%, transparent)`, color: statusColor }}
                >
                  {isConfigured ? "Configured" : "Not configured"}
                </span>
              </div>
              <p className="text-xs text-[var(--dpf-muted)] mb-2">{cfg.description}</p>

              {isConfigured && (
                <div className="mb-3 px-3 py-1.5 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
                  <span className="text-[10px] text-[var(--dpf-muted)] mr-2">Current:</span>
                  <span className="text-xs font-mono text-[var(--dpf-text)]">
                    {cfg.isSecret ? maskSecret(displayValue!) : displayValue}
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  value={values[cfg.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [cfg.key]: e.target.value }))}
                  placeholder={isConfigured ? (cfg.isSecret ? "Enter new key to replace" : "Enter new value to replace") : cfg.placeholder}
                  disabled={isPending}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  style={cfg.isSecret ? { WebkitTextSecurity: "disc" } as React.CSSProperties : undefined}
                />
                <button
                  onClick={() => handleSave(cfg.key)}
                  disabled={isPending || !values[cfg.key]?.trim()}
                  className="px-4 py-2 text-xs font-semibold bg-[var(--dpf-accent)] text-white rounded disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isPending ? "..." : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
