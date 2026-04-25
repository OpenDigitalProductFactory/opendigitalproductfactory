"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface Microsoft365CommunicationsConnectionState {
  status: "unconfigured" | "connected" | "error";
  tenantDisplayName: string | null;
  mailboxDisplayName: string | null;
  mailboxUserPrincipalName: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
}

export function Microsoft365CommunicationsConnectPanel({
  initialState,
}: {
  initialState: Microsoft365CommunicationsConnectionState;
}) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [mailboxUserPrincipalName, setMailboxUserPrincipalName] = useState(
    initialState.mailboxUserPrincipalName ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch("/api/integrations/microsoft365-communications/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          clientId,
          clientSecret,
          mailboxUserPrincipalName,
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
            Microsoft 365 Communications
          </h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Connect tenant-scoped Microsoft app credentials so DPF can read-first mailbox,
            calendar, and Teams context without brokering your Microsoft tenant.
          </p>
        </div>
        <StatusBadge status={initialState.status} />
      </header>

      {initialState.status === "connected" && (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          Connected
          {initialState.tenantDisplayName ? ` to ${initialState.tenantDisplayName}` : ""}
          {initialState.mailboxDisplayName ? ` for ${initialState.mailboxDisplayName}` : ""}.
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
          label="Tenant ID"
          hint="The Microsoft Entra tenant ID that scopes token issuance for this connector."
        >
          <input
            type="text"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm text-[var(--dpf-text)]"
          />
        </FormField>

        <FormField
          label="Client ID"
          hint="From the Microsoft app registration granted Graph application permissions for this tenant."
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
          hint="Stored encrypted in this install and used only for Microsoft Graph client-credentials exchange."
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
          label="Mailbox user principal name"
          hint="The mailbox UPN DPF should use for read-first inbox and calendar preview."
        >
          <input
            type="email"
            value={mailboxUserPrincipalName}
            onChange={(event) => setMailboxUserPrincipalName(event.target.value)}
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
            {submitting
              ? "Connecting…"
              : initialState.status === "connected"
                ? "Replace credentials"
                : "Connect"}
          </button>
          <a
            href="https://learn.microsoft.com/graph/permissions-reference"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--dpf-muted)] underline"
          >
            Microsoft Graph permissions →
          </a>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: Microsoft365CommunicationsConnectionState["status"];
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
