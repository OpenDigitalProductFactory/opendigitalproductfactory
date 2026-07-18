"use client";

import { useState, useTransition } from "react";
import { confirmDialog } from "@/components/ui/Dialog";
import {
  disconnectEmailPostmarkAction,
  saveEmailPostmarkAction,
} from "@/app/(shell)/platform/tools/integrations/email-postmark/actions";
import type { ConnectorPersistedSetupStatus } from "@/lib/integrations/kernel/setup-state";

type ConnectionState = {
  status: ConnectorPersistedSetupStatus;
  fromAddress: string | null;
  replyToAddress: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
};

type Props = {
  initialState: ConnectionState;
  defaultInboundWebhookUrl: string;
};

export function EmailPostmarkConnectPanel({ initialState, defaultInboundWebhookUrl }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await saveEmailPostmarkAction(form);
      if (!result.ok) setError(result.error);
      else window.location.reload();
    });
  }

  async function onDisconnect() {
    if (
      !(await confirmDialog({
        title: "Disconnect Postmark",
        message: "Disconnect Postmark? Outbound sends and inbound webhooks will stop.",
        tone: "danger",
        confirmLabel: "Disconnect",
      }))
    )
      return;
    startTransition(async () => {
      const result = await disconnectEmailPostmarkAction();
      if (!result.ok) setError(result.error);
      else window.location.reload();
    });
  }

  if (initialState.status === "connected") {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">Connected</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Sending as {initialState.fromAddress}
          {initialState.replyToAddress ? ` · replies to ${initialState.replyToAddress}` : ""}.
        </p>
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">
          Configure your Postmark Server inbound webhook to point at:
        </p>
        <pre className="mt-1 rounded bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
          POST {defaultInboundWebhookUrl}
        </pre>
        <div className="mt-4">
          <button
            type="button"
            onClick={onDisconnect}
            disabled={pending}
            className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-2 text-sm text-[var(--dpf-text)] disabled:opacity-50"
          >
            {pending ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-[var(--dpf-text)]">{error}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="text-base font-semibold text-[var(--dpf-text)]">Connect Postmark</h2>
      <p className="mt-1 text-sm text-[var(--dpf-muted)]">
        Provide your Postmark Server Token + Inbound webhook signing secret.
        DPF stores both encrypted and never proxies through a DPF-owned account.
      </p>
      {initialState.lastErrorMsg && (
        <p className="mt-2 rounded bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
          Last error: {initialState.lastErrorMsg}
        </p>
      )}
      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="text-[var(--dpf-text)]">Server token</span>
          <input
            name="serverToken"
            type="password"
            required
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
            placeholder="Server: API tokens → server-side token"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--dpf-text)]">Inbound webhook signing secret</span>
          <input
            name="signingSecret"
            type="password"
            required
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
            placeholder="Server: Inbound → Webhook signing secret"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--dpf-text)]">From address (must be verified in Postmark)</span>
          <input
            name="fromAddress"
            type="email"
            required
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
            placeholder="founder@yourdomain.example"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--dpf-text)]">Reply-to (optional)</span>
          <input
            name="replyToAddress"
            type="email"
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
            placeholder="founder@yourdomain.example"
          />
        </label>
        {error && <p className="text-sm text-[var(--dpf-text)]">{error}</p>}
        <p className="text-xs text-[var(--dpf-muted)]">
          Inbound webhook URL to configure in Postmark:{" "}
          <code className="text-[var(--dpf-text)]">{defaultInboundWebhookUrl}</code>
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[var(--dpf-accent)] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}
