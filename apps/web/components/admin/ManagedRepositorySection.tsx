"use client";

// Managed repository section (BI-985F4EC9) on /admin/platform-development.
// Design: docs/superpowers/specs/2026-10-14-managed-repository-connection-at-setup-design.md §3.2-3.4, §4.
//
// Shown only to installs whose confirmed purpose is evolve-dpf (the page
// decides). The operator names the repository, logs in to it with the device
// flow ("repository-controller" purpose), and sees one status per repository.
// The suggested repository fills the field but is only stored on Save; "Not
// now" stores nothing. The device-flow polling mirrors ConnectGitHubCard.
// Copy lives in the admin catalog (managedRepository.*); the status colour
// resolves through the report-kit registry (domain "managedRepository").

import { useEffect, useRef, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { initiateDeviceFlow, pollDeviceFlow } from "@/lib/actions/github-device-flow";
import { checkManagedRepository, saveManagedRepository } from "@/lib/actions/managed-repository";
import type { ManagedRepositoryStatus, ManagedRepositoryStatusView } from "@/lib/forge/managed-repository-access";
import { useT } from "@/lib/i18n/use-t";

export type ManagedRepositoryPresentation = {
  status: ManagedRepositoryStatus;
  /** Whether a "what to do next" hint is shown (every status but Connected). */
  hasHint: boolean;
  /** The one primary action for the first viewport. */
  primary: "connect" | "check";
};

const NEEDS_LOGIN: ReadonlySet<ManagedRepositoryStatus> = new Set(["not-connected", "login-expired", "no-access", "read-only"]);

/** Pure: what the section shows for a status view. */
export function presentManagedRepository(view: ManagedRepositoryStatusView): ManagedRepositoryPresentation {
  return {
    status: view.status,
    hasHint: view.status !== "connected",
    primary: NEEDS_LOGIN.has(view.status) ? "connect" : "check",
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

type HintStatus = Exclude<ManagedRepositoryStatus, "connected">;

export function ManagedRepositorySection({ initialStatus, suggestion }: ManagedRepositorySectionProps) {
  const t = useT("admin");
  const [view, setView] = useState(initialStatus);
  const [editing, setEditing] = useState(initialStatus.repository === null);
  const [skipped, setSkipped] = useState(false);
  const [draft, setDraft] = useState(initialStatus.repository?.fullName ?? suggestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<LoginState>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const statusLabel = (status: ManagedRepositoryStatus) => t(`managedRepository.status.${status}`);

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
        setAnnouncement(t("managedRepository.live.status", { status: statusLabel(result.data.status) }));
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
      const result = await pollDeviceFlow(sessionId).catch(() => ({ status: "error" as const, error: t("managedRepository.error.unreachable") }));
      if (result.status === "pending") return;
      if (result.status === "slow_down") {
        poll(sessionId, result.interval);
        return;
      }
      stopPolling();
      if (result.status === "success") {
        setLogin({ kind: "idle" });
        setAnnouncement(t("managedRepository.live.loggedIn"));
        await recheck();
        return;
      }
      if (/expired/i.test(result.error)) {
        setLogin({ kind: "expired" });
        setAnnouncement(t("managedRepository.live.expired"));
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
      setError(result?.error ?? t("managedRepository.error.unreachable"));
      return;
    }
    const { sessionId, userCode, verificationUri, interval } = result.data;
    setLogin({ kind: "awaiting", sessionId, userCode, verificationUri, copied: false });
    setAnnouncement(t("managedRepository.live.waiting"));
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
    <Surface
      as="section"
      id="managed-repository"
      aria-labelledby="managed-repository-heading"
      className="mb-6"
      data-testid="managed-repository-section"
    >
      <h2 id="managed-repository-heading" className="mb-2 text-base font-semibold text-[var(--dpf-text)]">
        {t("managedRepository.heading")}
      </h2>

      {editing && !skipped && (
        <div className="flex flex-col gap-2" data-testid="managed-repository-form">
          <label htmlFor="managed-repository-input" className="text-sm text-[var(--dpf-text)]">
            {t("managedRepository.repositoryLabel")}
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
            <Button size="sm" onClick={save} disabled={busy || !draft.trim()} data-testid="managed-repository-save">
              {t("managedRepository.save")}
            </Button>
            {repository ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                {t("managedRepository.cancel")}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setSkipped(true)} data-testid="managed-repository-not-now">
                {t("managedRepository.notNow")}
              </Button>
            )}
          </div>
        </div>
      )}

      {editing && skipped && (
        <div className="flex flex-wrap items-center gap-2" data-testid="managed-repository-skipped">
          <StatusBadge intent="neutral" label={t("managedRepository.notSet")} />
          <Button variant="secondary" size="sm" onClick={() => setSkipped(false)}>
            {t("managedRepository.setRepository")}
          </Button>
        </div>
      )}

      {!editing && repository && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2" aria-label={t("managedRepository.repositoriesLabel")}>
            <li className="flex flex-wrap items-center gap-2" data-testid="managed-repository-row">
              <span className="break-all font-mono text-sm text-[var(--dpf-text)]">{repository.fullName}</span>
              <span data-testid="managed-repository-status">
                <StatusBadge domain="managedRepository" status={view.status} label={statusLabel(view.status)} />
              </span>
            </li>
          </ul>
          {presentation.hasHint && (
            <p className="text-xs text-[var(--dpf-muted)]">{t(`managedRepository.hint.${view.status as HintStatus}`)}</p>
          )}
          {view.status === "check-failed" && view.lastAnsweredAt && (
            <p className="text-xs text-[var(--dpf-muted)]" data-testid="managed-repository-last-checked">
              {t("managedRepository.lastChecked")} <LocalTime value={view.lastAnsweredAt} />
            </p>
          )}

          {login.kind === "awaiting" ? (
            <div className="flex flex-col gap-2" data-testid="managed-repository-device-code">
              <p className="text-xs text-[var(--dpf-text)]">{t("managedRepository.enterCode")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="select-all rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-lg tracking-widest text-[var(--dpf-text)]">
                  {login.userCode}
                </code>
                <Button variant="secondary" size="sm" onClick={() => copyCode(login.userCode)}>
                  {login.copied ? t("managedRepository.copied") : t("managedRepository.copyCode")}
                </Button>
                <ButtonLink size="sm" href={login.verificationUri} target="_blank" rel="noopener noreferrer">
                  {t("managedRepository.openGitHub")}
                </ButtonLink>
                <Button variant="secondary" size="sm" onClick={cancelLogin}>
                  {t("managedRepository.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {presentation.primary === "connect" ? (
                <Button size="sm" onClick={connect} disabled={busy || login.kind === "starting"} data-testid="managed-repository-connect">
                  {login.kind === "expired" ? t("managedRepository.newCode") : t("managedRepository.connect")}
                </Button>
              ) : (
                <Button size="sm" onClick={recheck} disabled={busy} data-testid="managed-repository-check">
                  {t("managedRepository.checkAgain")}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                {t("managedRepository.change")}
              </Button>
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
    </Surface>
  );
}
