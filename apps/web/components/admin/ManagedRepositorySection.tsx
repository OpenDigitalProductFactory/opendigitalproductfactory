"use client";

// Managed repository section (BI-985F4EC9) on /admin/platform-development.
// Design: docs/superpowers/specs/2026-10-14-managed-repository-connection-at-setup-design.md §3.2-3.4, §4.
//
// Shown only to installs whose confirmed purpose is evolve-dpf (the page
// decides). The operator names the repository, logs in to it with the device
// flow ("repository-controller" purpose), and sees one status per repository.
// The suggested repository fills the field but is only stored on Save; "Not
// now" stores nothing. The device-flow polling mirrors ConnectGitHubCard.

import { useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import { initiateDeviceFlow, pollDeviceFlow } from "@/lib/actions/github-device-flow";
import { checkManagedRepository, saveManagedRepository } from "@/lib/actions/managed-repository";
import type { ManagedRepositoryStatus, ManagedRepositoryStatusView } from "@/lib/forge/managed-repository-access";
import type { Intent } from "@/lib/ui-model/statusColors";

// Kept local (not imported from the forge module) so this client bundle does
// not pull in the server-side GitHub adapter.
const STATUS_LABEL: Record<ManagedRepositoryStatus, string> = {
  connected: "Connected",
  "read-only": "Read only",
  "no-access": "No access",
  "login-expired": "Login expired",
  "not-connected": "Not connected",
  "check-failed": "Couldn't check",
};

const STATUS_INTENT: Record<ManagedRepositoryStatus, Intent> = {
  connected: "success",
  "read-only": "warning",
  "no-access": "danger",
  "login-expired": "warning",
  "not-connected": "neutral",
  "check-failed": "warning",
};

const STATUS_HINT: Record<ManagedRepositoryStatus, string | null> = {
  connected: null,
  "read-only": "This login can read but not label issues. Use an account with triage access.",
  "no-access": "This login cannot see the repository. Log in with an account that can.",
  "login-expired": "Log in again.",
  "not-connected": "Log in so the platform can read and label its issues.",
  "check-failed": "GitHub did not answer. Try again shortly.",
};

export type ManagedRepositoryPresentation = {
  label: string;
  intent: Intent;
  hint: string | null;
  /** The one primary action for the first viewport. */
  primary: "connect" | "check";
};

/** Pure: what the section shows for a status view. */
export function presentManagedRepository(view: ManagedRepositoryStatusView): ManagedRepositoryPresentation {
  const needsLogin = view.status === "not-connected" || view.status === "login-expired" || view.status === "no-access" || view.status === "read-only";
  return {
    label: STATUS_LABEL[view.status],
    intent: STATUS_INTENT[view.status],
    hint: STATUS_HINT[view.status],
    primary: needsLogin ? "connect" : "check",
  };
}

type LoginState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "awaiting"; sessionId: string; userCode: string; verificationUri: string; copied: boolean }
  | { kind: "expired" };

export interface ManagedRepositorySectionProps {
  initialStatus: ManagedRepositoryStatusView;
  /** Pre-fills the field; saved only when the operator presses Save. */
  suggestion: string;
}

const BUTTON = "rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] disabled:opacity-50";
const PRIMARY = "rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-on-accent)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)] disabled:opacity-50";

export function ManagedRepositorySection({ initialStatus, suggestion }: ManagedRepositorySectionProps) {
  const [view, setView] = useState(initialStatus);
  const [editing, setEditing] = useState(initialStatus.repository === null);
  const [skipped, setSkipped] = useState(false);
  const [draft, setDraft] = useState(initialStatus.repository?.fullName ?? suggestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<LoginState>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => () => stopPolling(), []);

  const recheck = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await checkManagedRepository();
      if (result.ok) {
        setView(result.data);
        setAnnouncement(`Status: ${STATUS_LABEL[result.data.status]}`);
      } else {
        setError(result.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveManagedRepository(draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setSkipped(false);
    } finally {
      setBusy(false);
    }
    await recheck();
  };

  const poll = (sessionId: string, intervalSec: number) => {
    stopPolling();
    timer.current = setInterval(async () => {
      const result = await pollDeviceFlow(sessionId).catch(() => ({ status: "error" as const, error: "GitHub did not answer." }));
      if (result.status === "pending") return;
      if (result.status === "slow_down") {
        poll(sessionId, result.interval);
        return;
      }
      stopPolling();
      if (result.status === "success") {
        setLogin({ kind: "idle" });
        setAnnouncement("Logged in. Checking the repository.");
        await recheck();
        return;
      }
      if (/expired/i.test(result.error)) {
        setLogin({ kind: "expired" });
        setAnnouncement("The code expired.");
        return;
      }
      setLogin({ kind: "idle" });
      setError(result.error);
    }, intervalSec * 1000);
  };

  const connect = async () => {
    setError(null);
    setLogin({ kind: "starting" });
    const result = await initiateDeviceFlow({ purpose: "repository-controller" }).catch(() => null);
    if (!result || !result.success) {
      setLogin({ kind: "idle" });
      setError(result?.error ?? "Could not reach GitHub.");
      return;
    }
    const { sessionId, userCode, verificationUri, interval } = result.data;
    setLogin({ kind: "awaiting", sessionId, userCode, verificationUri, copied: false });
    setAnnouncement("Waiting for you to approve on GitHub.");
    poll(sessionId, interval);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard?.writeText(code);
      setLogin((prev) => (prev.kind === "awaiting" ? { ...prev, copied: true } : prev));
    } catch {
      // The code stays selectable when the clipboard is unavailable.
    }
  };

  const cancelLogin = () => {
    stopPolling();
    setLogin({ kind: "idle" });
    setAnnouncement("");
  };

  const presentation = presentManagedRepository(view);
  const repository = view.repository;

  return (
    <section
      id="managed-repository"
      aria-labelledby="managed-repository-heading"
      className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      data-testid="managed-repository-section"
    >
      <h2 id="managed-repository-heading" className="mb-2 text-base font-semibold text-[var(--dpf-text)]">
        Managed repository
      </h2>

      {editing && !skipped && (
        <div className="flex flex-col gap-2" data-testid="managed-repository-form">
          <label htmlFor="managed-repository-input" className="text-sm text-[var(--dpf-text)]">
            GitHub repository
          </label>
          <input
            id="managed-repository-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="owner/name"
            autoComplete="off"
            spellCheck={false}
            className="w-full min-w-0 rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-sm text-[var(--dpf-text)]"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={busy || !draft.trim()} className={PRIMARY} data-testid="managed-repository-save">
              Save
            </button>
            {repository ? (
              <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
                Cancel
              </button>
            ) : (
              <button type="button" onClick={() => setSkipped(true)} className={BUTTON} data-testid="managed-repository-not-now">
                Not now
              </button>
            )}
          </div>
        </div>
      )}

      {editing && skipped && (
        <div className="flex flex-wrap items-center gap-2" data-testid="managed-repository-skipped">
          <StatusBadge intent="neutral" label="Not set" />
          <button type="button" onClick={() => setSkipped(false)} className={BUTTON}>
            Set repository
          </button>
        </div>
      )}

      {!editing && repository && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2" aria-label="Repositories">
            <li className="flex flex-wrap items-center gap-2" data-testid="managed-repository-row">
              <span className="break-all font-mono text-sm text-[var(--dpf-text)]">{repository.fullName}</span>
              <span data-testid="managed-repository-status">
                <StatusBadge intent={presentation.intent} label={presentation.label} />
              </span>
            </li>
          </ul>
          {presentation.hint && <p className="text-xs text-[var(--dpf-muted)]">{presentation.hint}</p>}
          {view.status === "check-failed" && view.lastAnsweredAt && (
            <p className="text-xs text-[var(--dpf-muted)]">
              Last checked: <LocalTime value={view.lastAnsweredAt} />
            </p>
          )}

          {login.kind === "awaiting" ? (
            <div className="flex flex-col gap-2" data-testid="managed-repository-device-code">
              <p className="text-xs text-[var(--dpf-text)]">Enter this code on GitHub:</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="select-all rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-lg tracking-widest text-[var(--dpf-text)]">
                  {login.userCode}
                </code>
                <button type="button" onClick={() => copyCode(login.userCode)} className={BUTTON}>
                  {login.copied ? "Copied" : "Copy code"}
                </button>
                <a href={login.verificationUri} target="_blank" rel="noopener noreferrer" className={PRIMARY}>
                  Open GitHub
                </a>
                <button type="button" onClick={cancelLogin} className={BUTTON}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {presentation.primary === "connect" ? (
                <button type="button" onClick={connect} disabled={busy || login.kind === "starting"} className={PRIMARY} data-testid="managed-repository-connect">
                  {login.kind === "expired" ? "Get a new code" : "Connect GitHub"}
                </button>
              ) : (
                <button type="button" onClick={recheck} disabled={busy} className={PRIMARY} data-testid="managed-repository-check">
                  Check again
                </button>
              )}
              <button type="button" onClick={() => setEditing(true)} className={BUTTON}>
                Change
              </button>
            </div>
          )}
        </div>
      )}

      <p aria-live="polite" className="sr-only" data-testid="managed-repository-live">
        {announcement}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--dpf-error)]" data-testid="managed-repository-error">
          {error}
        </p>
      )}
    </section>
  );
}
