// apps/web/components/platform/McpSyncButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerMcpCatalogSync } from "@/lib/actions/mcp-catalog";

export function McpSyncButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ fetched: number; upserted: number; isNew: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setError(null);
    setProgress({ fetched: 0, upserted: 0, isNew: 0 });

    startTransition(async () => {
      const result = await triggerMcpCatalogSync();
      if (!result.ok) {
        setError(result.message);
        setProgress(null);
        return;
      }

      if (result.syncId) {
        const evtSource = new EventSource(
          `/api/platform/integrations/sync-progress/${result.syncId}`
        );
        evtSource.onmessage = (e) => {
          const event = JSON.parse(e.data) as { type: string; totalFetched?: number; totalUpserted?: number; totalNew?: number };
          if (event.type === "sync:progress") {
            setProgress({
              fetched: event.totalFetched ?? 0,
              upserted: event.totalUpserted ?? 0,
              isNew: event.totalNew ?? 0,
            });
          }
          if (event.type === "done") {
            evtSource.close();
            setProgress(null);
            router.refresh();
          }
        };
        evtSource.onerror = () => {
          evtSource.close();
          setProgress(null);
          setError("Sync connection lost. Check sync history for status.");
          router.refresh();
        };
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleSync}
        disabled={disabled || isPending}
        className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
      >
        {isPending ? "Syncing…" : "Sync Now"}
      </button>
      {progress && (
        <p className="text-xs text-muted-foreground">
          Fetched {progress.fetched} · Upserted {progress.upserted} · New {progress.isNew}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
