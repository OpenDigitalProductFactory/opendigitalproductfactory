"use client";

// Phase 5 of BI-063BDF1B — admin-gated refresh button in the freshness
// header. Server-component parent passes `isAdmin: boolean`; this returns
// null for non-admin sessions so the surface is truly hidden, not just
// disabled.
//
// Spec: docs/superpowers/specs/2026-05-26-contributor-inventory-sync-design.md
//   §"Manual refresh affordance"

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineBusy } from "@/components/ui/InlineBusy";

import {
  getContributorInventorySyncStatusAction,
  triggerContributorInventorySyncAction,
  type ContributorInventorySyncStatus,
} from "@/lib/actions/contributor-inventory";

type ButtonState =
  | { kind: "idle" }
  | { kind: "dispatching" }
  | { kind: "polling"; startedAtMs: number }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = 5 * 60_000; // give up after 5 minutes — sync should complete well under this

export function RefreshContributorInventoryButton({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<ButtonState>({ kind: "idle" });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Auto-dismiss success/error toasts after 3.5s, mirroring PromptManager's
  // useState-only toast pattern.
  useEffect(() => {
    if (state.kind !== "success" && state.kind !== "error") return;
    const timer = setTimeout(() => setState({ kind: "idle" }), 3500);
    return () => clearTimeout(timer);
  }, [state]);

  // Cleanup polling interval on unmount.
  useEffect(() => clearPolling, [clearPolling]);

  const onClick = useCallback(async () => {
    if (state.kind !== "idle" && state.kind !== "success" && state.kind !== "error") {
      // Spam-click guard: ignore clicks while in-flight. The server-side
      // concurrency: { limit: 1 } collapses repeated dispatches anyway,
      // but the UX is clearer if the button visibly refuses.
      return;
    }
    setState({ kind: "dispatching" });
    const dispatch = await triggerContributorInventorySyncAction("refresh-button");
    if (!dispatch.ok) {
      setState({ kind: "error", message: dispatch.error });
      return;
    }
    const startedAtMs = Date.now();
    setState({ kind: "polling", startedAtMs });

    intervalRef.current = setInterval(async () => {
      try {
        const status = await getContributorInventorySyncStatusAction();
        if (!status) return; // runner hasn't created the row yet — keep polling
        if (status.startedAt.getTime() < startedAtMs - 1_000) {
          // The latest run is OLDER than our dispatch — the new run hasn't
          // started yet (queued behind an in-flight cron run). Keep polling.
          return;
        }
        if (isTerminal(status.status)) {
          clearPolling();
          if (status.status === "failed") {
            const errMsg = extractTerminalError(status);
            setState({ kind: "error", message: errMsg ?? "Sync failed" });
          } else {
            setState({ kind: "success", message: terminalSummary(status) });
            router.refresh();
          }
        }
      } catch (err) {
        clearPolling();
        setState({
          kind: "error",
          message: (err as Error).message ?? "Status check failed",
        });
      }
      if (Date.now() - startedAtMs > MAX_POLL_MS) {
        clearPolling();
        setState({
          kind: "error",
          message: "Sync timed out — check the platform notifications panel",
        });
      }
    }, POLL_INTERVAL_MS);
  }, [state.kind, router, clearPolling]);

  if (!isAdmin) return null;

  const disabled = state.kind === "dispatching" || state.kind === "polling";

  return (
    <div className="ml-auto flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label="Refresh contributor inventory now"
        className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors disabled:opacity-50"
        style={{
          borderColor: "var(--dpf-border)",
          color: "var(--dpf-text)",
          backgroundColor: "var(--dpf-surface-1)",
        }}
      >
        {state.kind === "dispatching" || state.kind === "polling" ? (
          <InlineBusy label="Syncing…" tone="current" />
        ) : (
          "Refresh now"
        )}
      </button>
      {state.kind === "success" ? (
        <span className="text-[10px] text-[var(--dpf-success)]" role="status">
          {state.message}
        </span>
      ) : null}
      {state.kind === "error" ? (
        <span className="text-[10px] text-[var(--dpf-error)]" role="status">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

function isTerminal(s: string): boolean {
  return s === "completed" || s === "partial" || s === "failed";
}

function terminalSummary(status: ContributorInventorySyncStatus): string {
  const psr = (status.perSourceResult ?? {}) as Record<
    string,
    { ok?: boolean; count?: number }
  >;
  const oks = Object.values(psr).filter((s) => s?.ok).length;
  const total = Object.keys(psr).length || 3;
  return `Synced ${oks}/${total} sources`;
}

function extractTerminalError(
  status: ContributorInventorySyncStatus,
): string | null {
  const psr = (status.perSourceResult ?? {}) as Record<
    string,
    { ok?: boolean; error?: string | null }
  >;
  const errors = Object.entries(psr)
    .filter(([, s]) => s && s.ok === false && s.error)
    .map(([k, s]) => `${k}: ${s.error}`);
  return errors.length > 0 ? errors.join("; ") : null;
}
