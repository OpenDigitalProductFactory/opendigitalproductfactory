"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface GoogleMarketingIntelligenceConnectionState {
  status: "unconfigured" | "connected" | "error";
  ga4PropertyId: string | null;
  searchConsoleSiteUrl: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
}

interface Props {
  initialState: GoogleMarketingIntelligenceConnectionState;
}

export function GoogleMarketingIntelligenceConnectPanel({ initialState }: Props) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [ga4PropertyId, setGa4PropertyId] = useState(initialState.ga4PropertyId ?? "");
  const [searchConsoleSiteUrl, setSearchConsoleSiteUrl] = useState(
    initialState.searchConsoleSiteUrl ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/integrations/google-marketing-intelligence/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          ga4PropertyId,
          searchConsoleSiteUrl,
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

      setClientSecret("");
      setRefreshToken("");
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
          <h2 className="text-xl font-semibold text-[var(--dpf-text)]">
            Google Marketing Intelligence
          </h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Connect Google OAuth credentials so DPF can verify GA4 and Search Console access and
            safely load read-first marketing intelligence.
          </p>
        </div>
        <StatusBadge status={initialState.status} />
      </header>

      {initialState.status === "connected" && (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          Connected
          {initialState.ga4PropertyId ? ` to GA4 property ${initialState.ga4PropertyId}` : ""}
          {initialState.searchConsoleSiteUrl ? ` and ${initialState.searchConsoleSiteUrl}` : ""}.
          {initialState.lastTestedAt && (
            <span className="ml-2 text-[var(--dpf-muted)]">
              Last verified {formatDateTime(initialState.lastTestedAt)}.
            </span>
          )}
        </div>
      )}

      {initialState.status === "error" && initialState.lastErrorMsg && (
        <div
          role="alert"
          className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700"
        >
          Last connect attempt failed: {initialState.lastErrorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="Client ID"
          hint="Use a Google OAuth client that has offline access enabled for Analytics and Search Console."
        >
          <input
            type="text"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm text-[var(--dpf-text)]"
          />
        </FormField>

        <FormField
          label="Client Secret"
          hint="Stored encrypted in this install and used only to refresh short-lived Google access tokens."
        >
          <input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm text-[var(--dpf-text)]"
          />
        </FormField>

        <FormField
          label="Refresh Token"
          hint="Paste the refresh token from the consent flow. DPF exchanges it for a short-lived access token when preview data is loaded."
        >
          <textarea
            value={refreshToken}
            onChange={(event) => setRefreshToken(event.target.value)}
            required
            rows={4}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs text-[var(--dpf-text)]"
          />
        </FormField>

        <FormField
          label="GA4 Property ID"
          hint="Numeric GA4 property ID used for summary traffic and conversion reporting."
        >
          <input
            type="text"
            value={ga4PropertyId}
            onChange={(event) => setGa4PropertyId(event.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm text-[var(--dpf-text)]"
          />
        </FormField>

        <FormField
          label="Search Console Site URL"
          hint='Use the verified site identifier, for example "sc-domain:example.com" or the exact URL-prefix property.'
        >
          <input
            type="text"
            value={searchConsoleSiteUrl}
            onChange={(event) => setSearchConsoleSiteUrl(event.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm text-[var(--dpf-text)]"
          />
        </FormField>

        {formError && (
          <div
            role="alert"
            className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700"
          >
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
            href="https://developers.google.com/identity/protocols/oauth2/web-server"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--dpf-muted)] underline"
          >
            Google OAuth docs →
          </a>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: GoogleMarketingIntelligenceConnectionState["status"];
}) {
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
