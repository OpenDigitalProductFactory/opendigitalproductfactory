"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkMcpServerHealthAction } from "@/lib/actions/mcp-services";

export function HealthCheckButton({ serverId }: { serverId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ healthy?: boolean; latencyMs?: number; message?: string } | null>(null);

  function handleCheck() {
    setResult(null);
    startTransition(async () => {
      const res = await checkMcpServerHealthAction(serverId);
      setResult({ healthy: res.healthy, latencyMs: res.latencyMs, message: res.message });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleCheck}
        disabled={isPending}
        className="px-3 py-1.5 rounded border text-sm hover:bg-muted disabled:opacity-50"
      >
        {isPending ? "Checking..." : "Check Now"}
      </button>
      {result && (
        <span className={`text-xs ${result.healthy ? "text-green-600" : "text-red-600"}`}>
          {result.message}{result.latencyMs != null ? ` (${result.latencyMs}ms)` : ""}
        </span>
      )}
    </div>
  );
}
