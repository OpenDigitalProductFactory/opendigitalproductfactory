// apps/web/components/platform/McpSyncButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerMcpCatalogSync } from "@/lib/actions/mcp-catalog";
import { useResilientEventSource } from "@/lib/hooks/useResilientEventSource";

export function McpSyncButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ fetched: number; upserted: number; isNew: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncId, setSyncId] = useState<string | null>(null);

  // Resilient SSE (BI-1AFF530D): the catalog-sync progress stream now carries
  // the heartbeat watchdog (lib/hooks/useResilientEventSource) so it cannot
  // become a zombie holding an HTTP/1.1 connection slot if the portal rebuilds
  // mid-sync — the recurring "Chrome wedged after a portal rebuild" defect
  // (BI-864E83B0). Driven by `syncId`: set when the sync starts, nulled on the
  // terminal "done" event so the hook tears down instead of reconnecting to a
  // finished stream.
  useResilientEventSource(
    syncId ? `/api/platform/integrations/sync-progress/${syncId}` : null,
    {
      onMessage: (e) => {
        try {
          const event = JSON.parse(e.data) as {
            type: string;
            totalFetched?: number;
            totalUpserted?: number;
            totalNew?: number;
          };
          if (event.type === "sync:progress") {
            setProgress({
              fetched: event.totalFetched ?? 0,
              upserted: event.totalUpserted ?? 0,
              isNew: event.totalNew ?? 0,
            });
          }
          if (event.type === "done") {
            setSyncId(null);
            setProgress(null);
            router.refresh();
          }
        } catch {
          // Malformed frame — ignore; the watchdog handles dead streams.
        }
      },
    },
  );

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
        // Subscribe via the resilient hook (declared above) by recording the
        // sync id; the hook owns connect/heartbeat-watchdog/teardown.
        setSyncId(result.syncId);
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
