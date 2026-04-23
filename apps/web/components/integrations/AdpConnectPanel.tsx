"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AdpConnectionState {
  status: "unconfigured" | "connected" | "error" | "expired";
  certExpiresAt: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
  environment: "sandbox" | "production" | null;
}

interface Props {
  initialState: AdpConnectionState;
}

export function AdpConnectPanel({ initialState }: Props) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [certPem, setCertPem] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
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
      const res = await fetch("/api/integrations/adp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          clientSecret,
          certPem,
          privateKeyPem,
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
      setPrivateKeyPem("");
      router.refresh();
    } catch {
      setFormError("Unable to reach the server. Check your network and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const connected = initialState.status === "connected";

  return (
    <div className="space-y-6 rounded-lg border border-[var(--dpf-border)] p-6">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">ADP Workforce Now</h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Connect your ADP API Central account so the Payroll Specialist can answer payroll
            questions. Your credentials never leave this install.
          </p>
        </div>
        <StatusBadge state={initialState} />
      </header>

      {connected && initialState.certExpiresAt && (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-3 text-sm">
          Connected{initialState.environment ? ` (${initialState.environment})` : ""} — certificate
          expires {formatDate(initialState.certExpiresAt)}.
          {isExpiringSoon(initialState.certExpiresAt) && (
            <span className="ml-2 text-amber-600">
              Rotation due within 60 days — generate a new cert in ADP Partner Self-Service.
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
          hint="From ADP Partner Self-Service → Apps → Your App → Credentials"
        >
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm"
          />
        </FormField>

        <FormField
          label="Client Secret"
          hint="Revealed only once when generated — regenerate in ADP if you've lost it."
        >
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            required
            autoComplete="off"
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm"
          />
        </FormField>

        <FormField
          label="Certificate (PEM)"
          hint="From ADP Partner Self-Service → Certificates → Download public cert"
        >
          <textarea
            value={certPem}
            onChange={(e) => setCertPem(e.target.value)}
            required
            rows={6}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs"
            placeholder="-----BEGIN CERTIFICATE-----"
          />
        </FormField>

        <FormField
          label="Private Key (PEM)"
          hint="The key generated with your CSR — not the same as the certificate."
        >
          <textarea
            value={privateKeyPem}
            onChange={(e) => setPrivateKeyPem(e.target.value)}
            required
            rows={6}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs"
            placeholder="-----BEGIN PRIVATE KEY-----"
          />
        </FormField>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Environment</legend>
          <div className="flex gap-4 text-sm">
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
            {submitting ? "Connecting…" : connected ? "Replace credentials" : "Connect"}
          </button>
          <a
            href="https://developers.adp.com/articles/general/generate-a-certificate-signing-request"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--dpf-muted)] underline"
          >
            ADP setup docs →
          </a>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ state }: { state: AdpConnectionState }) {
  if (state.status === "connected") {
    return (
      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700">
        Connected
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700">
        Error
      </span>
    );
  }
  if (state.status === "expired") {
    return (
      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700">
        Expired
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
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--dpf-muted)]">{hint}</span>}
    </label>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function isExpiringSoon(iso: string): boolean {
  try {
    const expiresAt = new Date(iso).getTime();
    const sixtyDaysInMs = 60 * 24 * 60 * 60 * 1000;
    return expiresAt - Date.now() < sixtyDaysInMs;
  } catch {
    return false;
  }
}
