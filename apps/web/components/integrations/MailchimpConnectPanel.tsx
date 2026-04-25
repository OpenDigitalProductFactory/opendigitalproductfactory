"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface MailchimpConnectionState {
  status: "unconfigured" | "connected" | "error";
  serverPrefix: string | null;
  accountName: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
}

interface Props {
  initialState: MailchimpConnectionState;
}

export function MailchimpConnectPanel({ initialState }: Props) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [serverPrefix, setServerPrefix] = useState(initialState.serverPrefix ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/integrations/mailchimp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, serverPrefix }),
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

      setApiKey("");
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
          <h2 className="text-xl font-semibold text-[var(--dpf-text)]">Mailchimp Marketing</h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Connect a customer-supplied Mailchimp API key so DPF can verify account access and
            safely read-first marketing audiences and campaigns.
          </p>
        </div>
        <StatusBadge status={initialState.status} />
      </header>

      {initialState.status === "connected" && (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          Connected
          {initialState.accountName ? ` to ${initialState.accountName}` : ""}
          {initialState.serverPrefix ? ` (${initialState.serverPrefix})` : ""}.
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
          className="rounded border p-3 text-sm"
          style={{
            borderColor: "var(--dpf-warning)",
            backgroundColor: "color-mix(in srgb, var(--dpf-warning) 12%, transparent)",
            color: "var(--dpf-text)",
          }}
        >
          Last connect attempt failed: {initialState.lastErrorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="Server Prefix"
          hint="Use the Mailchimp datacenter prefix embedded in the API key, such as us21."
        >
          <input
            type="text"
            value={serverPrefix}
            onChange={(event) => setServerPrefix(event.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-sm text-[var(--dpf-text)]"
          />
        </FormField>

        <FormField
          label="API Key"
          hint="Create a Mailchimp marketing API key with audience and campaign read scopes, then paste it here."
        >
          <textarea
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            required
            rows={4}
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs text-[var(--dpf-text)]"
          />
        </FormField>

        {formError && (
          <div
            role="alert"
            className="rounded border p-3 text-sm"
            style={{
              borderColor: "var(--dpf-warning)",
              backgroundColor: "color-mix(in srgb, var(--dpf-warning) 12%, transparent)",
              color: "var(--dpf-text)",
            }}
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
            {submitting ? "Connecting…" : initialState.status === "connected" ? "Replace key" : "Connect"}
          </button>
          <a
            href="https://mailchimp.com/developer/marketing/api/"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--dpf-muted)] underline"
          >
            Mailchimp API docs →
          </a>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ status }: { status: MailchimpConnectionState["status"] }) {
  if (status === "connected") {
    return (
      <span
        className="rounded-full border px-2 py-1 text-xs font-medium"
        style={{
          borderColor: "var(--dpf-success)",
          backgroundColor: "color-mix(in srgb, var(--dpf-success) 12%, transparent)",
          color: "var(--dpf-success)",
        }}
      >
        Connected
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className="rounded-full border px-2 py-1 text-xs font-medium"
        style={{
          borderColor: "var(--dpf-warning)",
          backgroundColor: "color-mix(in srgb, var(--dpf-warning) 12%, transparent)",
          color: "var(--dpf-warning)",
        }}
      >
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
