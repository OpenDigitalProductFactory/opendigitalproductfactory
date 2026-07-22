"use client";

// apps/web/components/storefront-admin/content-editing-ui.tsx
//
// BI-CBE9B9B3 — shared, mobile-safe editing primitives for the menu and section
// editors. Three problems the terse per-row controls had, solved once here:
//
//   • Action overload / tiny targets — RowActionSheet collapses a row's many
//     terse controls into ONE 44px trigger that opens a labelled action sheet;
//     every action inside is a full, row-specific sentence.
//   • Silent mutations — useRowMutations tracks pending / saved / failed per row
//     with a Retry path, and MutationStatus renders it inline.
//   • Blind public changes — confirmPublicChange previews what changes, where it
//     shows, and whether the live site is affected before anything runs.
//
// GeneratedResidueBanner is the grouped cross-archetype recovery surface.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog, alertDialog } from "@/components/ui/Dialog";
import {
  recoverGeneratedResidue,
  type RecoverResidueResult,
} from "@/lib/storefront/content-recovery-actions";
import type { ResidueGroup } from "@/lib/storefront/content-fit";

// ─── Per-row mutation state ─────────────────────────────────────────────────

export type MutationPhase = "idle" | "pending" | "saved" | "failed";
export interface MutationState {
  phase: MutationPhase;
  error?: string;
}

export interface RowMutations {
  status: Record<string, MutationState>;
  /** Run a mutation under `key`, tracking pending/saved/failed and storing a retry. */
  run: (key: string, action: () => Promise<void>) => Promise<void>;
  retry: (key: string) => void;
  get: (key: string) => MutationState;
}

/**
 * Tracks the state of keyed row mutations. Optimistic UI stays the caller's
 * responsibility (it owns the list state); this hook owns the *feedback* — what
 * the owner sees while a change is saving, once it saved, or when it failed, and
 * the retry that re-runs the exact same action.
 */
export function useRowMutations(): RowMutations {
  const [status, setStatus] = useState<Record<string, MutationState>>({});
  const retries = useRef<Record<string, () => Promise<void>>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of Object.values(t)) clearTimeout(id);
    };
  }, []);

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    retries.current[key] = action;
    if (timers.current[key]) clearTimeout(timers.current[key]);
    setStatus((s) => ({ ...s, [key]: { phase: "pending" } }));
    try {
      await action();
      setStatus((s) => ({ ...s, [key]: { phase: "saved" } }));
      timers.current[key] = setTimeout(() => {
        setStatus((s) => {
          if (s[key]?.phase !== "saved") return s;
          const next = { ...s };
          delete next[key];
          return next;
        });
      }, 2500);
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [key]: { phase: "failed", error: err instanceof Error ? err.message : "Something went wrong" },
      }));
      throw err;
    }
  }, []);

  const retry = useCallback(
    (key: string) => {
      const action = retries.current[key];
      if (action) void run(key, action);
    },
    [run],
  );

  const get = useCallback((key: string): MutationState => status[key] ?? { phase: "idle" }, [status]);

  return { status, run, retry, get };
}

/** Inline pending/saved/failed pill with a Retry affordance on failure. */
export function MutationStatus({
  state,
  onRetry,
  label = "change",
}: {
  state: MutationState;
  onRetry?: () => void;
  label?: string;
}) {
  if (state.phase === "idle") return null;
  if (state.phase === "pending") {
    return (
      <span role="status" className="text-[11px] text-[var(--dpf-muted)]">
        Saving…
      </span>
    );
  }
  if (state.phase === "saved") {
    return (
      <span role="status" className="text-[11px] text-[var(--dpf-success)]">
        Saved
      </span>
    );
  }
  return (
    <span role="alert" className="inline-flex items-center gap-1.5 text-[11px] text-[var(--dpf-error)]">
      Couldn’t save {label}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center rounded border border-[var(--dpf-error)]/40 px-2 font-medium text-[var(--dpf-error)] hover:bg-[var(--dpf-error)]/10"
        >
          Retry
        </button>
      )}
    </span>
  );
}

// ─── Row action sheet ───────────────────────────────────────────────────────

export interface RowAction {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

/**
 * One 44px trigger per row that opens a bottom action sheet. Collapsing a row's
 * controls to a single trigger is what takes the pages from ~70 tap targets to
 * one-per-row; the sheet then affords full, row-specific labels with generous
 * hit areas that a phone can actually tap.
 */
export function RowActionSheet({
  rowLabel,
  actions,
}: {
  /** The row's own name, e.g. "Table for 2" — used for the trigger's accessible name. */
  rowLabel: string;
  actions: RowAction[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Manage ${rowLabel}`}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-[var(--dpf-border)] px-3 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
      >
        Manage
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Actions for ${rowLabel}`}
            className="w-full max-w-md rounded-t-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 shadow-xl sm:rounded-2xl"
          >
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
              {rowLabel}
            </p>
            <div className="flex flex-col">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  className={`flex min-h-[44px] items-center rounded-lg px-3 text-left text-sm hover:bg-[var(--dpf-surface-2)] disabled:opacity-40 ${
                    action.tone === "danger" ? "text-[var(--dpf-error)]" : "text-[var(--dpf-text)]"
                  }`}
                >
                  {action.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-1 flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--dpf-border)] px-3 text-sm font-medium text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Preview-before-execute confirm ─────────────────────────────────────────

/**
 * Preview a public-site-affecting change before it runs: what changes, where it
 * appears on the public page, and whether the live site is affected right now.
 */
export function confirmPublicChange(opts: {
  verb: string;
  target: string;
  /** Where on the public page this shows, e.g. "your public menu". */
  where: string;
  isPublished: boolean;
  danger?: boolean;
  confirmLabel?: string;
}): Promise<boolean> {
  const liveLine = opts.isPublished
    ? "Your public page is live, so visitors will see this change straight away."
    : "Your public page isn’t published yet, so visitors won’t see this until you publish.";
  return confirmDialog({
    title: `${opts.verb} ${opts.target}?`,
    message: `This will ${opts.verb.toLowerCase()} “${opts.target}”.\n\nWhere it shows: ${opts.where}.\n${liveLine}`,
    tone: opts.danger ? "danger" : "default",
    confirmLabel: opts.confirmLabel ?? opts.verb,
  });
}

// ─── Generated / cross-archetype residue recovery ───────────────────────────

/**
 * Grouped recovery banner. Surfaces cross-archetype and duplicate residue the
 * owner never chose, and removes each group in one previewed action with an
 * affected-artifact list. Renders nothing when there is no residue.
 */
export function GeneratedResidueBanner({
  storefrontId,
  groups,
  isPublished,
}: {
  storefrontId: string;
  groups: ResidueGroup[];
  isPublished: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busy = busyKey !== null;

  if (groups.length === 0) return null;

  const totalItems = groups.reduce((n, g) => n + g.itemIds.length, 0);
  const totalSections = groups.reduce((n, g) => n + g.sectionIds.length, 0);

  async function removeGroups(target: ResidueGroup[], key: string) {
    const itemIds = target.flatMap((g) => g.itemIds);
    const sectionIds = target.flatMap((g) => g.sectionIds);
    const names = target.flatMap((g) => [...g.itemNames, ...g.sectionNames]);
    const preview =
      names.length <= 8 ? names.map((n) => `• ${n}`).join("\n") : `${names.length} items and sections`;
    const liveLine = isPublished
      ? "Your public page is live, so this is removed from what visitors see."
      : "Your public page isn’t published yet, so visitors aren’t affected.";
    const confirmed = await confirmDialog({
      title: "Remove generated content?",
      message: `This removes:\n${preview}\n\n${liveLine}\nContent with real bookings or enquiries is turned off instead of deleted.`,
      tone: "danger",
      confirmLabel: `Remove ${itemIds.length + sectionIds.length}`,
    });
    if (!confirmed) return;

    // The recovery runs OUTSIDE any React transition: alertDialog dispatches a
    // DialogHost state update that never renders interactively inside a deferred
    // transition, silently wedging the button (BI-FE7C543C). A plain busy flag
    // keeps the result dialogs reachable.
    setBusyKey(key);
    let result: RecoverResidueResult;
    try {
      result = await recoverGeneratedResidue(storefrontId, { itemIds, sectionIds });
    } catch {
      result = { error: "Recovery failed. Please try again." };
    }
    setBusyKey(null);
    if ("error" in result) {
      await alertDialog({ title: "Couldn’t remove content", message: result.error, tone: "danger" });
      return;
    }
    const parts: string[] = [];
    if (result.removedItems) parts.push(`${result.removedItems} removed`);
    if (result.removedSections) parts.push(`${result.removedSections} section${result.removedSections === 1 ? "" : "s"} removed`);
    if (result.deactivatedItems) parts.push(`${result.deactivatedItems} turned off (had bookings/enquiries)`);
    await alertDialog({
      title: "Recovered",
      message: parts.length ? parts.join(", ") + "." : "Done.",
    });
    router.refresh();
  }

  return (
    <section
      aria-label="Generated content needing review"
      data-testid="residue-recovery"
      className="mb-4 rounded-lg border p-3"
      style={{ borderColor: "var(--dpf-warning)", background: "var(--dpf-state-warning)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
            Found content that doesn’t fit your storefront
          </h3>
          <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
            {totalItems > 0 && `${totalItems} item${totalItems === 1 ? "" : "s"}`}
            {totalItems > 0 && totalSections > 0 && " and "}
            {totalSections > 0 && `${totalSections} section${totalSections === 1 ? "" : "s"}`}
            {" "}look generated from a different business type. Review before removing.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-md border border-[var(--dpf-border)] px-3 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          {expanded ? "Hide" : "Review"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.key} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
              <p className="text-xs font-semibold text-[var(--dpf-text)]">
                {group.title} ({group.count})
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--dpf-muted)]">{group.description}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {[...group.itemNames, ...group.sectionNames].map((name, i) => (
                  <li
                    key={`${group.key}-${i}`}
                    className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[11px] text-[var(--dpf-text)]"
                  >
                    {name}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => removeGroups([group], group.key)}
                className="mt-2 inline-flex min-h-[44px] items-center rounded-md border border-[var(--dpf-error)]/40 px-3 text-xs font-medium text-[var(--dpf-error)] hover:bg-[var(--dpf-error)]/10 disabled:opacity-50"
              >
                {busyKey === group.key ? "Removing…" : `Remove ${group.title.toLowerCase()}`}
              </button>
            </div>
          ))}

          {groups.length > 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => removeGroups(groups, "__all__")}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--dpf-error)] px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busyKey === "__all__" ? "Removing…" : `Remove all (${totalItems + totalSections})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
