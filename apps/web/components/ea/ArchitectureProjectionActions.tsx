"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { refreshSysmlProjections } from "@/lib/actions/sysml-projections";

export function ArchitectureProjectionActions() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    setMessage(null);
    startTransition(async () => {
      const result = await refreshSysmlProjections();
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      const routing = result.aiRoutingArchitecture;
      setMessage(
        routing.status === "skipped"
          ? "Refresh completed, but the AI routing projection was unavailable."
          : `Routing architecture refreshed: ${routing.created} created, ${routing.updated} updated, ${routing.crossLayerLinked} cross-view links current.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={refresh}
        disabled={isPending}
        className="min-h-11 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)] disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? "Refreshing architecture…" : "Refresh live projections"}
      </button>
      <p aria-live="polite" className="m-0 max-w-md text-right text-dpf-caption text-[var(--dpf-muted)]">
        {message ?? "Rebuilds governed BPMN, SysML, and ArchiMate views from their canonical sources."}
      </p>
    </div>
  );
}
