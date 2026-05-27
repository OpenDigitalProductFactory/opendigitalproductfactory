"use client";

import { useState, useTransition } from "react";
import {
  disconnectLinkedInAction,
  startLinkedInOAuthAction,
} from "@/app/(shell)/platform/tools/integrations/linkedin-personal-social/actions";

type ConnectionState = {
  status: "unconfigured" | "pending-oauth" | "connected" | "error";
  redirectUri: string | null;
  memberDisplayName: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
};

type Props = {
  initialState: ConnectionState;
  defaultRedirectUri: string;
};

export function LinkedInConnectPanel({ initialState, defaultRedirectUri }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onStart(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await startLinkedInOAuthAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.location.href = result.authorizeUrl;
    });
  }

  function onDisconnect() {
    if (!confirm("Disconnect the LinkedIn integration? You will need to re-authorize to publish again.")) return;
    startTransition(async () => {
      const result = await disconnectLinkedInAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.location.reload();
    });
  }

  if (initialState.status === "connected") {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">Connected</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          {initialState.memberDisplayName
            ? `Posting as ${initialState.memberDisplayName}.`
            : "Member identity captured from /v2/userinfo."}
        </p>
        {initialState.lastTestedAt && (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Last verified {new Date(initialState.lastTestedAt).toLocaleString()}.
          </p>
        )}
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
      <h2 className="text-base font-semibold text-[var(--dpf-text)]">
        {initialState.status === "pending-oauth" ? "Resume authorization" : "Connect your LinkedIn app"}
      </h2>
      <p className="mt-1 text-sm text-[var(--dpf-muted)]">
        Provide the OAuth credentials from your LinkedIn developer app. DPF stores them encrypted
        and exchanges the authorization code on your behalf.
      </p>
      {initialState.lastErrorMsg && (
        <p className="mt-2 rounded bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
          Last error: {initialState.lastErrorMsg}
        </p>
      )}
      <form className="mt-4 space-y-3" onSubmit={onStart}>
        <label className="block text-sm">
          <span className="text-[var(--dpf-text)]">Client ID</span>
          <input
            name="clientId"
            type="text"
            required
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
            placeholder="86xxxxxxxxxx"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--dpf-text)]">Client secret</span>
          <input
            name="clientSecret"
            type="password"
            required
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
            placeholder="WPL_AP1.xxxxxxxxxxxx"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--dpf-text)]">Redirect URI (must match your LinkedIn app)</span>
          <input
            name="redirectUri"
            type="url"
            required
            defaultValue={initialState.redirectUri ?? defaultRedirectUri}
            className="mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-[var(--dpf-text)]">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[var(--dpf-accent)] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Starting…" : "Connect"}
        </button>
      </form>
    </section>
  );
}
