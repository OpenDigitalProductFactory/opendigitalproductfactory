"use client";

import { useState } from "react";
import { beginServiceAccountSetupAction, type BeginSetupResult } from "./actions";

export function ServiceAccountSetupForm() {
  const [siteKey, setSiteKey] = useState("");
  const [accountKey, setAccountKey] = useState("default");
  const [domains, setDomains] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BeginSetupResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const res = await beginServiceAccountSetupAction({
      siteKey,
      accountKey,
      targetDomains: domains.split(",").map((d) => d.trim()).filter(Boolean),
      loginUrl,
    });
    setResult(res);
    setPending(false);
  }

  const field =
    "w-full text-sm px-2.5 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]";
  const label = "block text-xs font-medium text-[var(--dpf-muted)] mb-1";

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 space-y-3"
    >
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Set up a service account</h2>
      <p className="text-xs text-[var(--dpf-muted)]">
        Registers the scoped service identity and its allowlist. You then complete a one-time
        attended login so the coworker can act on this site autonomously — the profile holds only
        this account&apos;s logins.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Site key</label>
          <input className={field} value={siteKey} onChange={(e) => setSiteKey(e.target.value)} placeholder="substack" required />
        </div>
        <div>
          <label className={label}>Account</label>
          <input className={field} value={accountKey} onChange={(e) => setAccountKey(e.target.value)} placeholder="default" />
        </div>
      </div>
      <div>
        <label className={label}>Target domains (comma-separated allowlist)</label>
        <input className={field} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="substack.com" required />
      </div>
      <div>
        <label className={label}>Login URL (optional)</label>
        <input className={field} value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="https://substack.com/sign-in" />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white disabled:opacity-60"
      >
        {pending ? "Registering…" : "Begin setup"}
      </button>

      {result && !result.ok && (
        <p className="text-xs text-[var(--dpf-error)]">{result.error}</p>
      )}
      {result && result.ok && (
        <div className="text-xs text-[var(--dpf-text)] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-1">
          <p className="font-medium">Service identity registered.</p>
          <p className="text-[var(--dpf-muted)]">Principal: <span className="font-mono">{result.principalId}</span></p>
          <p className="text-[var(--dpf-muted)]">Profile: <span className="font-mono">{result.profileRef}</span></p>
          <p>
            Next: complete the one-time attended login
            {result.loginUrl ? <> at <span className="font-mono">{result.loginUrl}</span></> : null} so the
            profile captures this account&apos;s session. The profile then appears below as configured.
          </p>
        </div>
      )}
    </form>
  );
}
