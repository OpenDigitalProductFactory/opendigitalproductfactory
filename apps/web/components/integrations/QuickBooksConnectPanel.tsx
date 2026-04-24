"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface QuickBooksConnectionState {
  status: "unconfigured" | "connected" | "error";
  companyName: string | null;
  realmId: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
  environment: "sandbox" | "production" | null;
}

interface Props {
  initialState: QuickBooksConnectionState;
}

export function QuickBooksConnectPanel({ initialState }: Props) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [realmId, setRealmId] = useState(initialState.realmId ?? "");
  const [environment, setEnvironment] = useState<"sandbox" | "production">(
    initialState.environment ?? "sandbox",
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/integrations/quickbooks/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          realmId,
          environment,
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
          <h2 className="text-xl font-semibold text-[var(--dpf-text)]">QuickBooks Online</h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Connect your Intuit app credentials so DPF can verify company access and safely
            read-first accounting context.
          </p>
        </div>
        <StatusBadge status={initialState.status} />
      </header>

      {initialState.status === "connected" && (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          Connected
          {initialState.companyName ? ` to ${initialState.companyName}` : ""}
          {initialState.realmId ? ` (realm ${initialState.realmId})` : ""}.
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
          hint="From the Intuit Developer Portal app that is authorized for this QuickBooks company."
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
          hint="Stored encrypted in this install and used only to refresh QuickBooks access tokens."
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
          hint="Paste the latest refresh token from your Intuit OAuth flow. DPF exchanges this for a short-lived access token and stores the rotated refresh token."
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
          label="Realm ID"
          hint="The QuickBooks company ID that scopes accounting requests for this tenant."
        >
          <input
            type="text"
            value={realmId}
            onChange={(event) => setRealmId(event.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm text-[var(--dpf-text)]"
          />
        </FormField>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-[var(--dpf-text)]">Environment</legend>
          <div className="flex gap-4 text-sm text-[var(--dpf-text)]">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="environment"
                value="sandbox"
                checked={environment === "sandbox"}
                onChange={() => setEnvironment("sandbox")}
              />
              Sandbox
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="environment"
                value="production"
                checked={environment === "production"}
                onChange={() => setEnvironment("production")}
              />
              Production
            </label>
          </div>
        </fieldset>

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
            href="https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--dpf-muted)] underline"
          >
            Intuit OAuth docs →
          </a>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ status }: { status: QuickBooksConnectionState["status"] }) {
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
