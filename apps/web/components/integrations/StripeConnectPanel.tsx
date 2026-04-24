"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface StripeConnectionState {
  status: "unconfigured" | "connected" | "error";
  mode: "test" | "live" | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
}

export function StripeConnectPanel({
  initialState,
}: {
  initialState: StripeConnectionState;
}) {
  const router = useRouter();
  const [secretKey, setSecretKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch("/api/integrations/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretKey }),
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

      setSecretKey("");
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
          <h2 className="text-xl font-semibold text-[var(--dpf-text)]">Stripe Billing & Payments</h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Connect a Stripe secret or restricted key so DPF can read balance, customer, invoice,
            and payment intent context without brokering your Stripe account.
          </p>
        </div>
        <StatusBadge status={initialState.status} />
      </header>

      {initialState.status === "connected" && (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          Connected{initialState.mode ? ` in ${initialState.mode} mode` : ""}.
          {initialState.lastTestedAt && (
            <span className="ml-2 text-[var(--dpf-muted)]">
              Last verified {formatDateTime(initialState.lastTestedAt)}.
            </span>
          )}
        </div>
      )}

      {initialState.status === "error" && initialState.lastErrorMsg && (
        <div role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
          Last connect attempt failed: {initialState.lastErrorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-[var(--dpf-text)]">Secret or restricted key</span>
          <textarea
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            required
            rows={3}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs text-[var(--dpf-text)]"
          />
          <span className="block text-xs text-[var(--dpf-muted)]">
            DPF stores the key encrypted in this install and uses it only for read-first Stripe API calls.
          </span>
        </label>

        {formError && (
          <div role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Connecting…" : initialState.status === "connected" ? "Replace key" : "Connect"}
          </button>
          <a
            href="https://docs.stripe.com/api"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--dpf-muted)] underline"
          >
            Stripe API docs →
          </a>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ status }: { status: StripeConnectionState["status"] }) {
  if (status === "connected") {
    return (
      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700">
        Connected
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700">
        Error
      </span>
    );
  }

  return (
    <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-xs font-medium text-[var(--dpf-muted)]">
      Not connected
    </span>
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
