"use client";

/**
 * BI-B0E4F3F1 — Automation-friendly in-app dialogs.
 *
 * Drop-in replacements for the browser's native `window.confirm()`,
 * `window.alert()`, and `window.prompt()`. Native dialogs are a dead end for
 * agent automation: Claude-in-Chrome / CDP `Input.dispatchMouseEvent` times out
 * while a native dialog is open, and the action only commits when a HUMAN clicks
 * OK. They also block the JS thread, ignore the platform theme, and can't be
 * tested. This module renders REAL DOM (role="dialog", aria-modal, themed via
 * `--dpf-*` tokens) with stable `data-dialog-action` refs an agent can find and
 * click — so every confirm/alert/prompt flow is completable end-to-end by DOM
 * automation with no human in the loop.
 *
 * Usage (imperative, async — same call shape as the native globals):
 *
 *     import { confirmDialog, alertDialog, promptDialog } from "@/components/ui/Dialog";
 *
 *     if (!(await confirmDialog(`Delete "${name}"?`))) return;          // was: confirm(...)
 *     await alertDialog("PDF generation failed. Please try again.");     // was: alert(...)
 *     const reason = await promptDialog("Rejection reason:");            // was: prompt(...)
 *
 * The imperative functions resolve against a single `<DialogHost />` mounted
 * once at the root layout. Requests made before the host mounts (or while one is
 * open) are queued and shown in order.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type DialogTone = "default" | "danger";

interface CommonOptions {
  title?: string;
  /** Body text. Plain string so the imperative API can be called from anywhere. */
  message?: string;
  tone?: DialogTone;
  confirmLabel?: string;
}

export interface ConfirmOptions extends CommonOptions {
  cancelLabel?: string;
}

export type AlertOptions = CommonOptions;

export interface PromptOptions extends CommonOptions {
  cancelLabel?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Render a multi-line <textarea> instead of a single-line <input>. */
  multiline?: boolean;
  /** When true, the confirm button stays disabled until the field is non-empty. */
  required?: boolean;
}

type DialogKind = "confirm" | "alert" | "prompt";

interface DialogState {
  id: number;
  kind: DialogKind;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: DialogTone;
  defaultValue: string;
  placeholder?: string;
  multiline: boolean;
  required: boolean;
  resolve: (value: boolean | string | null) => void;
}

// --- Singleton dispatch channel ------------------------------------------------
// The host registers `pushDialog` on mount. Requests raised before the host is
// ready are buffered in `pending` and flushed on registration.
let idCounter = 0;
let pushDialog: ((d: DialogState) => void) | null = null;
const pending: DialogState[] = [];

function dispatch(d: DialogState) {
  if (pushDialog) pushDialog(d);
  else pending.push(d);
}

function normalize(opts: CommonOptions | string): CommonOptions {
  return typeof opts === "string" ? { message: opts } : opts;
}

/** In-app replacement for `window.confirm`. Resolves true on confirm, false otherwise. */
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o = normalize(opts) as ConfirmOptions;
  return new Promise<boolean>((resolve) => {
    dispatch({
      id: ++idCounter,
      kind: "confirm",
      title: o.title ?? "Confirm",
      message: o.message,
      confirmLabel: o.confirmLabel ?? "Confirm",
      cancelLabel: o.cancelLabel ?? "Cancel",
      tone: o.tone ?? "default",
      defaultValue: "",
      multiline: false,
      required: false,
      resolve: (v) => resolve(Boolean(v)),
    });
  });
}

/** In-app replacement for `window.alert`. Resolves when the user dismisses it. */
export function alertDialog(opts: AlertOptions | string): Promise<void> {
  const o = normalize(opts);
  return new Promise<void>((resolve) => {
    dispatch({
      id: ++idCounter,
      kind: "alert",
      title: o.title ?? "Notice",
      message: o.message,
      confirmLabel: o.confirmLabel ?? "OK",
      cancelLabel: "",
      tone: o.tone ?? "default",
      defaultValue: "",
      multiline: false,
      required: false,
      resolve: () => resolve(),
    });
  });
}

/** In-app replacement for `window.prompt`. Resolves the entered string, or null on cancel. */
export function promptDialog(opts: PromptOptions | string): Promise<string | null> {
  const o = normalize(opts) as PromptOptions;
  return new Promise<string | null>((resolve) => {
    dispatch({
      id: ++idCounter,
      kind: "prompt",
      title: o.title ?? "Input required",
      message: o.message,
      confirmLabel: o.confirmLabel ?? "Submit",
      cancelLabel: o.cancelLabel ?? "Cancel",
      tone: o.tone ?? "default",
      defaultValue: o.defaultValue ?? "",
      placeholder: o.placeholder,
      multiline: o.multiline ?? false,
      required: o.required ?? false,
      resolve: (v) => resolve(typeof v === "string" ? v : null),
    });
  });
}

// --- Host ----------------------------------------------------------------------

/**
 * Mounted exactly once at the root layout. Renders queued dialog requests and
 * resolves their promises. Without this host mounted, the imperative functions
 * buffer their requests and never resolve, so keep it in the root tree.
 */
export function DialogHost() {
  const [queue, setQueue] = useState<DialogState[]>([]);
  const current = queue[0] ?? null;
  const [value, setValue] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    pushDialog = (d) => setQueue((q) => [...q, d]);
    if (pending.length) {
      const flush = pending.splice(0, pending.length);
      setQueue((q) => [...q, ...flush]);
    }
    return () => {
      pushDialog = null;
    };
  }, []);

  // Reset the prompt field whenever a new dialog becomes current, and move
  // focus to the most relevant control for keyboard + automation reach.
  useEffect(() => {
    if (!current) return;
    setValue(current.defaultValue);
    const t = setTimeout(() => {
      if (current.kind === "prompt") inputRef.current?.focus();
      else confirmRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [current]);

  const settle = useCallback(
    (d: DialogState, result: boolean | string | null) => {
      d.resolve(result);
      setQueue((q) => q.filter((x) => x.id !== d.id));
    },
    [],
  );

  const onCancel = useCallback(() => {
    if (!current) return;
    settle(current, current.kind === "prompt" ? null : false);
  }, [current, settle]);

  const onConfirm = useCallback(() => {
    if (!current) return;
    if (current.kind === "prompt") {
      if (current.required && value.trim() === "") return;
      settle(current, value);
    } else {
      settle(current, true);
    }
  }, [current, settle, value]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        // In a multiline prompt, Enter inserts a newline; Cmd/Ctrl+Enter submits.
        if (current?.kind === "prompt" && current.multiline && !(e.metaKey || e.ctrlKey)) {
          return;
        }
        e.preventDefault();
        onConfirm();
      }
    },
    [current, onCancel, onConfirm],
  );

  if (!current) return null;

  const confirmDisabled =
    current.kind === "prompt" && current.required && value.trim() === "";
  const isDanger = current.tone === "danger";

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        // Click on the backdrop (not the panel) cancels, matching native dismissal.
        if (e.target === e.currentTarget && current.kind !== "alert") onCancel();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        role={current.kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`dpf-dialog-title-${current.id}`}
        aria-describedby={current.message ? `dpf-dialog-msg-${current.id}` : undefined}
        data-dpf-dialog={current.kind}
        className="w-full max-w-md rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 shadow-xl"
      >
        <h2
          id={`dpf-dialog-title-${current.id}`}
          className="mb-2 text-base font-semibold text-[var(--dpf-text)]"
        >
          {current.title}
        </h2>
        {current.message && (
          <p
            id={`dpf-dialog-msg-${current.id}`}
            className="mb-4 whitespace-pre-wrap text-sm text-[var(--dpf-muted)]"
          >
            {current.message}
          </p>
        )}

        {current.kind === "prompt" &&
          (current.multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              data-dialog-input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={current.placeholder}
              rows={3}
              className="mb-4 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              data-dialog-input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={current.placeholder}
              className="mb-4 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
            />
          ))}

        <div className="flex justify-end gap-2">
          {current.kind !== "alert" && (
            <button
              type="button"
              data-dialog-action="cancel"
              onClick={onCancel}
              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-1)]"
            >
              {current.cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            data-dialog-action="confirm"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`rounded px-3 py-1.5 text-sm font-semibold text-[var(--dpf-on-accent)] disabled:opacity-50 ${
              isDanger
                ? "bg-[var(--dpf-error)] hover:opacity-90"
                : "bg-[var(--dpf-accent)] hover:opacity-90"
            }`}
          >
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
