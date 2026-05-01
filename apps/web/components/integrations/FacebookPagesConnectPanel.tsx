"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface FacebookPagesConnectionState {
  status: "unconfigured" | "connected" | "error";
  pageId: string | null;
  pageName: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
}

interface Props {
  initialState: FacebookPagesConnectionState;
}

const statusToneClasses = {
  connected:
    "border-[var(--dpf-success)]/30 bg-[color-mix(in_srgb,var(--dpf-success)_12%,transparent)] text-[var(--dpf-success)]",
  error:
    "border-[var(--dpf-error)]/30 bg-[color-mix(in_srgb,var(--dpf-error)_12%,transparent)] text-[var(--dpf-error)]",
  unconfigured: "border-[var(--dpf-border)] text-[var(--dpf-muted)]",
} satisfies Record<FacebookPagesConnectionState["status"], string>;

const errorMessageClasses =
  "rounded border border-[var(--dpf-error)]/30 bg-[color-mix(in_srgb,var(--dpf-error)_12%,transparent)] p-3 text-sm text-[var(--dpf-error)]";

export function FacebookPagesConnectPanel({ initialState }: Props) {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [pageId, setPageId] = useState(initialState.pageId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/integrations/facebook-pages/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          pageId,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(
          typeof payload.error === "string"
            ? payload.error
            : `Connect failed with status ${res.status}`,
        );
        router.refresh();
        return;
      }

      setAccessToken("");
      router.refresh();
    } catch {
      setFormError("Unable to reach the server. Check your network and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--dpf-text)]">Facebook Pages</h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Connect a customer-supplied Meta page token so DPF can verify local page presence,
            read recent posts, and understand comment activity before any write automation is added.
          </p>
        </div>
        <StatusBadge status={initialState.status} />
      </header>

      {initialState.status === "connected" && (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          Connected
          {initialState.pageName ? ` to ${initialState.pageName}` : ""}
          {initialState.pageId ? ` (${initialState.pageId})` : ""}.
          {initialState.lastTestedAt && (
            <span className="ml-2 text-[var(--dpf-muted)]">
              Last verified {formatDateTime(initialState.lastTestedAt)}.
            </span>
          )}
        </div>
      )}

      {initialState.status === "error" && initialState.lastErrorMsg && (
        <div role="alert" className={errorMessageClasses}>
          Last connect attempt failed: {initialState.lastErrorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="Page Access Token"
          hint="Use a customer-managed Meta token that can read the target page, posts, and comments. DPF stores it encrypted in this install."
        >
          <textarea
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            required
            rows={4}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs text-[var(--dpf-text)]"
          />
        </FormField>

        <FormField
          label="Page ID"
          hint="Use the Meta page ID for the location, practice, or local storefront you want DPF to monitor."
        >
          <input
            type="text"
            value={pageId}
            onChange={(event) => setPageId(event.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm text-[var(--dpf-text)]"
          />
        </FormField>

        {formError && (
          <div role="alert" className={errorMessageClasses}>
            {formError}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Connecting…" : initialState.status === "connected" ? "Replace credentials" : "Connect"}
          </button>
          <a
            href="https://www.facebook.com/business/tools/facebook-pages"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--dpf-muted)] underline"
          >
            Meta Pages docs →
          </a>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: FacebookPagesConnectionState["status"];
}) {
  if (status === "connected") {
    return (
      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusToneClasses.connected}`}>
        Connected
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusToneClasses.error}`}>
        Error
      </span>
    );
  }

  return (
    <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusToneClasses.unconfigured}`}>
      Not connected
    </span>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-[var(--dpf-text)]">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--dpf-muted)]">{hint}</span>}
    </label>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
