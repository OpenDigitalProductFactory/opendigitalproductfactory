"use client";

import { useState, useTransition } from "react";

import { issueEdgeNodeBootstrapToken } from "@/lib/actions/edge-node-actions";

type IssuedToken = {
  plaintext: string;
  prefix: string;
  expiresAt: string;
};

export function IssueBootstrapTokenModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [ttlMinutes, setTtlMinutes] = useState(15);
  const [token, setToken] = useState<IssuedToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleIssue() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await issueEdgeNodeBootstrapToken({ ttlMinutes });
        setToken(result);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function handleCopy() {
    if (!token) return;
    void navigator.clipboard.writeText(token.plaintext).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        setError(
          "Could not copy to clipboard. Select the token manually below.",
        );
      },
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-bootstrap-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 shadow-lg">
        <h3
          id="issue-bootstrap-title"
          className="text-base font-semibold text-[var(--dpf-text)] mb-3"
        >
          {token ? "Bootstrap token issued" : "Issue Edge Node bootstrap token"}
        </h3>

        {!token ? (
          <>
            <p className="mb-4 text-sm text-[var(--dpf-muted)]">
              Issues a one-time, single-use enrollment token. Copy it
              immediately — it is shown <strong>exactly once</strong> and
              cannot be retrieved later.
            </p>

            <label className="block mb-4 text-sm text-[var(--dpf-text)]">
              <span className="block mb-1">TTL (minutes)</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={ttlMinutes}
                onChange={(e) => setTtlMinutes(Number(e.target.value))}
                className="w-32 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[var(--dpf-text)]"
              />
              <span className="block mt-1 text-xs text-[var(--dpf-muted)]">
                Default 15 min; max 1440 (24h).
              </span>
            </label>

            {error && (
              <p className="mb-3 text-sm text-red-700">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleIssue}
                disabled={isPending}
                className="rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {isPending ? "Issuing..." : "Issue token"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-[var(--dpf-text)]">
              Copy this token and paste it into the Edge Node&apos;s
              <code className="mx-1 text-xs">DPF_BOOTSTRAP_TOKEN</code> env.
              It expires at <b>{new Date(token.expiresAt).toLocaleString()}</b>
              {" "}and can be used only once.
            </p>

            <div className="mb-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
              <code className="block break-all font-mono text-sm text-[var(--dpf-text)]">
                {token.plaintext}
              </code>
            </div>

            <p className="mb-4 text-xs text-[var(--dpf-muted)]">
              After closing this dialog, the token cannot be retrieved.
              If you lose it, revoke it from the list and issue a new one.
            </p>

            {error && (
              <p className="mb-3 text-sm text-red-700">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
              >
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-white"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
