"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerProviderSync } from "@/lib/actions/ai-providers";

type Props = {
  lastSyncAt: Date | null;
};

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function SyncProvidersButton({ lastSyncAt }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isStale = !lastSyncAt || Date.now() - new Date(lastSyncAt).getTime() > ONE_MONTH_MS;

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      try {
        const res = await triggerProviderSync();
        if (res.error) {
          setResult({ ok: false, message: res.error });
        } else {
          setResult({ ok: true, message: `${res.added} added, ${res.updated} updated` });
        }
        router.refresh();
      } catch (err) {
        setResult({ ok: false, message: err instanceof Error ? err.message : "Sync failed" });
      }
    });
  }

  const baseStyle: React.CSSProperties = {
    fontSize: 10,
    padding: "4px 12px",
    borderRadius: 4,
    cursor: isPending ? "not-allowed" : "pointer",
    opacity: isPending ? 0.7 : 1,
    transition: "all 0.15s ease",
  };

  const buttonStyle: React.CSSProperties = isStale
    ? {
        ...baseStyle,
        background: "color-mix(in srgb, var(--dpf-accent) 12%, transparent)",
        border: "1px solid var(--dpf-accent)",
        color: "var(--dpf-accent)",
        fontWeight: 600,
      }
    : {
        ...baseStyle,
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        color: "var(--dpf-text)",
      };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button onClick={handleClick} disabled={isPending} style={buttonStyle}>
        {isPending ? "Updating…" : "Update Providers"}
      </button>
      {result && (
        <span style={{ fontSize: 10, color: result.ok ? "var(--dpf-success)" : "var(--dpf-error)" }}>
          {result.ok ? "✓" : "✗"} {result.message}
        </span>
      )}
      {!result && isStale && !isPending && (
        <span style={{ fontSize: 10, color: "var(--dpf-warning)" }}>
          {lastSyncAt ? "Last updated over a month ago" : "Never synced"}
        </span>
      )}
    </span>
  );
}
