"use client";

// SavedConnectionRow — interactive widget for a single DiscoveryConnection.
//
// Why this exists:
//   Before this component, /platform/tools/discovery hid the Add CTA the
//   moment connectionCount > 0 and offered no other way to edit, re-test, or
//   delete a saved row. Operators who pasted a wrong key (auth_failed) had no
//   recovery path inside the UI — they had to ask a developer to run SQL.
//
// What it offers:
//   - Status chip (active / auth_failed / unreachable / unconfigured / …)
//   - lastTested timestamp + last-result message
//   - Re-test button (existing testDiscoveryConnection server action)
//   - Edit button → reuses ConfigureConnectionInline in "edit" mode
//     (URL + site pre-filled; API key blank with "leave blank to keep" hint)
//   - Delete button with confirm step

import { useState, useTransition } from "react";
import { RelativeTime } from "@/components/ui/RelativeTime";
import {
  deleteDiscoveryConnection,
  rerunDiscoveryConnection,
  testDiscoveryConnection,
  type DiscoveryConnectionSummary,
} from "@/lib/actions/discovery";
import { ConfigureConnectionInline } from "./ConfigureConnectionInline";

type Props = {
  connection: DiscoveryConnectionSummary;
};

const STATUS_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "err" | "muted" }> = {
  active:        { label: "Active",         tone: "ok" },
  unconfigured:  { label: "Unconfigured",   tone: "muted" },
  auth_failed:   { label: "Auth Failed",    tone: "err" },
  unreachable:   { label: "Unreachable",    tone: "err" },
  tls_error:     { label: "TLS Error",      tone: "err" },
  error:         { label: "Error",          tone: "err" },
};

const TONE_STYLES: Record<"ok" | "warn" | "err" | "muted", { bg: string; fg: string }> = {
  ok:    { bg: "var(--dpf-state-success)", fg: "var(--dpf-success)" },
  warn:  { bg: "var(--dpf-state-warning)", fg: "var(--dpf-warning)" },
  err:   { bg: "var(--dpf-state-error)",   fg: "var(--dpf-error)" },
  muted: { bg: "var(--dpf-surface-2)",     fg: "var(--dpf-muted)" },
};

export function SavedConnectionRow({ connection }: Props) {
  const [mode, setMode] = useState<"view" | "editing" | "confirming-delete">("view");
  const [lastAction, setLastAction] = useState<{ kind: "ok" | "err"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRunning, startRerun] = useTransition();

  const statusInfo = STATUS_LABELS[connection.status] ?? { label: connection.status, tone: "muted" as const };
  const tone = TONE_STYLES[statusInfo.tone];

  const handleRerun = () => {
    setLastAction(null);
    startRerun(async () => {
      const result = await rerunDiscoveryConnection(connection.id);
      if (!result.ok) {
        setLastAction({ kind: "err", message: result.error });
        return;
      }
      setLastAction({
        kind: "ok",
        message: `Re-run complete — ${result.itemCount} item(s), ${result.relationshipCount} relationship(s)`,
      });
    });
  };

  const handleRetest = () => {
    setLastAction(null);
    startTransition(async () => {
      const result = await testDiscoveryConnection(connection.id);
      if (!result.ok) {
        setLastAction({ kind: "err", message: result.error });
        return;
      }
      if (result.status === "ok") {
        setLastAction({ kind: "ok", message: `Test passed — ${result.deviceCount ?? 0} device(s) discovered` });
      } else {
        setLastAction({ kind: "err", message: result.message ?? `Test returned ${result.status}` });
      }
    });
  };

  const handleDelete = () => {
    setLastAction(null);
    startTransition(async () => {
      const result = await deleteDiscoveryConnection(connection.id);
      if (!result.ok) {
        setLastAction({ kind: "err", message: result.error });
        setMode("view");
        return;
      }
      // On success the page revalidates via the server action, so this row vanishes.
    });
  };

  if (mode === "editing") {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Editing: {connection.name}
          </p>
          <button
            type="button"
            onClick={() => setMode("view")}
            className="text-xs text-[var(--dpf-muted)] underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        </div>
        <ConfigureConnectionInline
          gatewayName={connection.name}
          gatewayAddress={connection.endpointUrl.replace(/^https?:\/\//, "")}
          gatewayEntityId={connection.gatewayEntityId ?? undefined}
          existing={{
            id: connection.id,
            collectorType: connection.collectorType,
            site: (connection.configuration.site as string | undefined) ?? "default",
            tlsInsecure: (connection.configuration.tlsInsecure as boolean | undefined) ?? false,
            hasApiKey: connection.hasApiKey,
          }}
          onComplete={() => setMode("view")}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--dpf-text)]">{connection.name}</p>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: tone.bg, color: tone.fg }}
            >
              {statusInfo.label}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-[var(--dpf-muted)]">
            {connection.collectorType} · {connection.endpointUrl}
          </p>
          <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">
            Last tested <RelativeTime value={connection.lastTestedAt} />
            {connection.lastTestMessage && (
              <span className="ml-1">— {connection.lastTestMessage}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleRerun}
            disabled={isPending || isRunning}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
          >
            {isRunning ? "Running…" : "Re-run"}
          </button>
          <button
            type="button"
            onClick={handleRetest}
            disabled={isPending || isRunning}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
          >
            {isPending && mode === "view" ? "Testing…" : "Re-test"}
          </button>
          <button
            type="button"
            onClick={() => setMode("editing")}
            disabled={isPending}
            className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
          >
            Edit
          </button>
          {mode === "confirming-delete" ? (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="rounded-md bg-[var(--dpf-error)] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setMode("view")}
                disabled={isPending}
                className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs text-[var(--dpf-text)]"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setMode("confirming-delete")}
              disabled={isPending}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs text-[var(--dpf-muted)] hover:border-[var(--dpf-error)] hover:text-[var(--dpf-error)]"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {lastAction && (
        <p
          className={`mt-3 text-xs ${
            lastAction.kind === "ok" ? "text-[var(--dpf-success)]" : "text-[var(--dpf-error)]"
          }`}
        >
          {lastAction.message}
        </p>
      )}
    </div>
  );
}
