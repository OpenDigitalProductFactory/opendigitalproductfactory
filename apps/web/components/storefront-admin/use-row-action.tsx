"use client";
import { useCallback, useRef, useState } from "react";

/**
 * Per-row action feedback for owner content managers.
 *
 * A non-technical owner needs to see that a publish-affecting change (hide an
 * item, reorder a section) is in progress, succeeded, or failed — and be able to
 * retry a failure — rather than a bare fetch that silently no-ops. The `run`
 * callback owns the request AND applies the state change only on confirmed
 * success, so a failed save never leaves the UI showing a change that did not
 * persist. Mirrors the pending/succeeded/failed shape already used by
 * StorefrontInbox's send-to-backlog action.
 */
export type RowActionStatus =
  | { kind: "saving"; message: string }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string; retry: () => void };

const SAVED_LINGER_MS = 2500;

export function useRowActions() {
  const [statuses, setStatuses] = useState<Record<string, RowActionStatus | undefined>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const scheduleSavedClear = useCallback((key: string) => {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      setStatuses((current) => {
        if (current[key]?.kind !== "saved") return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }, SAVED_LINGER_MS);
  }, []);

  const runRowAction = useCallback(
    (
      key: string,
      opts: {
        savingMessage: string;
        successMessage: string;
        /** Performs the request and applies state on success. Must throw on failure. */
        run: () => Promise<void>;
      },
    ): Promise<boolean> => {
      const attempt = async (): Promise<boolean> => {
        if (timers.current[key]) clearTimeout(timers.current[key]);
        setStatuses((current) => ({ ...current, [key]: { kind: "saving", message: opts.savingMessage } }));
        try {
          await opts.run();
          setStatuses((current) => ({ ...current, [key]: { kind: "saved", message: opts.successMessage } }));
          scheduleSavedClear(key);
          return true;
        } catch (err) {
          const message = err instanceof Error && err.message ? err.message : "Couldn't save. Try again.";
          setStatuses((current) => ({
            ...current,
            [key]: { kind: "error", message, retry: () => void attempt() },
          }));
          return false;
        }
      };
      return attempt();
    },
    [scheduleSavedClear],
  );

  return { statuses, runRowAction };
}

/** Throws a friendly error when a storefront admin mutation response is not ok. */
export async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    /* non-JSON error body — keep the fallback */
  }
  throw new Error(message);
}

/** Inline, screen-reader-announced result of the most recent row action. */
export function RowStatus({ status }: { status: RowActionStatus | undefined }) {
  if (!status) return null;
  const color =
    status.kind === "error" ? "var(--dpf-error)" : status.kind === "saved" ? "var(--dpf-success)" : "var(--dpf-muted)";
  return (
    <div role="status" aria-live="polite" className="mt-1.5 flex items-center gap-2" style={{ fontSize: 11, color }}>
      <span>
        {status.kind === "saved" ? "✓ " : status.kind === "error" ? "⚠ " : ""}
        {status.message}
      </span>
      {status.kind === "error" && (
        <button
          onClick={status.retry}
          className="underline underline-offset-2 text-[var(--dpf-accent)]"
          style={{ fontSize: 11 }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
