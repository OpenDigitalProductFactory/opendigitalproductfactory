"use client";

import { useState, useTransition } from "react";
import { savePlatformApiKey } from "@/lib/actions/ai-providers";

type KeyConfig = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  configured: boolean;
  isSecret: boolean;
};

const PLATFORM_KEYS: Omit<KeyConfig, "configured">[] = [
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

type Props = {
  keyStatuses: Record<string, boolean>;
};

export function PlatformKeysPanel({ keyStatuses }: Props) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  function handleSave(key: string) {
    const value = values[key];
    if (!value?.trim()) return;
    startTransition(async () => {
      await savePlatformApiKey(key, value.trim());
      setSaved((prev) => ({ ...prev, [key]: true }));
      setValues((prev) => ({ ...prev, [key]: "" }));
    });
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Platform API Keys</h2>
      <p className="text-sm text-[var(--dpf-muted)] mb-4">
        External service keys used by the platform. These are stored encrypted and never displayed after saving.
      </p>

      <div className="space-y-3">
        {PLATFORM_KEYS.map((cfg) => {
          const isConfigured = keyStatuses[cfg.key] || saved[cfg.key];
          const statusColor = isConfigured ? "#4ade80" : "#fbbf24";

          return (
            <div
              key={cfg.key}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: statusColor }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-white">{cfg.label}</span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: `${statusColor}20`, color: statusColor }}
                >
                  {isConfigured ? "Configured" : "Not configured"}
                </span>
              </div>
              <p className="text-xs text-[var(--dpf-muted)] mb-3">{cfg.description}</p>
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
                  className="flex-1 px-3 py-2 text-xs font-mono bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-white outline-none focus:border-[var(--dpf-accent)]"
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
