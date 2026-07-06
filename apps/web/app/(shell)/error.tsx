"use client";

import { useEffect, useRef, useState } from "react";
import { UpstreamEscalation } from "@/components/feedback/UpstreamEscalation";
import { isDeploymentSkewError, SKEW_RELOAD_KEY, SKEW_RELOAD_WINDOW_MS } from "@/lib/deployment-skew";

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  // BI-D22D4607: stale-tab deployment skew. A tab loaded from the previous
  // build fails its next server-action POST / chunk load after a self-upgrade
  // swaps the image. That's routine, not a crash — reload once onto the
  // current build instead of alarming the operator with this screen (and skip
  // the critical auto-report for the auto-recovered case). The sessionStorage
  // timestamp guard makes a second skew error within the window fall through
  // to the normal crash screen: reloading didn't fix it, so it's real.
  const isSkew = isDeploymentSkewError(error.message);
  const skewDecisionRef = useRef<boolean | null>(null);
  function shouldAutoReload(): boolean {
    if (skewDecisionRef.current !== null) return skewDecisionRef.current;
    let decision = false;
    if (isSkew && typeof window !== "undefined") {
      try {
        const last = Number(sessionStorage.getItem(SKEW_RELOAD_KEY) ?? "0");
        if (!Number.isFinite(last) || Date.now() - last >= SKEW_RELOAD_WINDOW_MS) {
          sessionStorage.setItem(SKEW_RELOAD_KEY, String(Date.now()));
          decision = true;
        }
      } catch {
        // sessionStorage unavailable (private mode edge cases) — without the
        // reload-loop guard we must not auto-reload; show the normal screen.
      }
    }
    skewDecisionRef.current = decision;
    return decision;
  }
  const [autoReloading, setAutoReloading] = useState(false);
  useEffect(() => {
    if (shouldAutoReload()) {
      setAutoReloading(true);
      window.location.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // BI-B4F401B3: crash-boundary diagnostic prompt. The production error message
  // is sanitized by Next.js — only the digest survives to the client. Rather
  // than let downstream triage guess a (usually wrong) root cause, we hand the
  // operator a copy-paste prompt for their AI client, which can read the server
  // logs and resolve the real error. See apps/web/lib/operate/issue-report-triage.ts.
  const [deployedSha, setDeployedSha] = useState<string | null>(null);
  const [autoReportId, setAutoReportId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  // Stamp the crash time once, on mount, so the prompt is stable across renders.
  const [crashTime] = useState(() => new Date().toISOString());

  const route = typeof window !== "undefined" ? window.location.pathname : "";
  const cleanError =
    error.message?.replace(/\s+/g, " ").trim().slice(0, 240) || "Unknown error";
  const [description, setDescription] = useState("");

  // Auto-report on mount. Resolve the deployed SHA first, then file the report
  // (with digest + SHA) and capture its reportId so the diagnostic prompt can
  // reference it. Fire-and-forget for the page, but we await internally so the
  // prompt is populated.
  useEffect(() => {
    // Auto-recovering deployment skew is not a reportable crash (BI-D22D4607).
    if (shouldAutoReload()) return;
    const body = {
      type: "runtime_error",
      severity: "critical",
      title: error.message?.slice(0, 200) || "Page crash",
      description: error.message,
      routeContext: typeof window !== "undefined" ? window.location.pathname : null,
      errorStack: error.stack?.slice(0, 20000),
      errorDigest: error.digest ?? null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      source: "crash_boundary",
    };

    let cancelled = false;

    (async () => {
      // Resolve the running image SHA (best-effort).
      let sha: string | null = null;
      try {
        const vres = await fetch("/api/platform/version");
        if (vres.ok) {
          const v = (await vres.json()) as { gitSha?: unknown };
          sha = typeof v.gitSha === "string" ? v.gitSha : null;
        }
      } catch {
        /* version unavailable — prompt shows a retrieval hint instead */
      }
      if (!cancelled && sha) setDeployedSha(sha);

      try {
        const res = await fetch("/api/quality/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, deployedSha: sha }),
        });
        if (res.ok) {
          const data = (await res.json()) as { reportId?: string };
          if (!cancelled && typeof data.reportId === "string") setAutoReportId(data.reportId);
        }
      } catch {
        // Queue to localStorage if fetch fails
        try {
          const key = "dpf-quality-queue";
          const raw = localStorage.getItem(key);
          const queue = raw ? JSON.parse(raw) : [];
          if (Array.isArray(queue)) {
            queue.push({ ...body, deployedSha: sha, queuedAt: new Date().toISOString() });
            localStorage.setItem(key, JSON.stringify(queue));
          }
        } catch { /* silent */ }
      } finally {
        if (!cancelled) setPrepared(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [error]);

  // The copy-paste prompt the operator drops into Claude / Codex / Grok. It
  // bundles everything the AI client needs to find the REAL error in the server
  // logs and resolve it — exactly the path a human operator would take.
  const diagnosticPrompt = [
    "You are debugging a production crash in the DPF portal. Investigate it on the live install and resolve it.",
    "",
    `Route: ${route || "(unknown)"}`,
    `Error digest: ${error.digest || "(none captured)"}`,
    `Crash time: ${crashTime}`,
    `Deployed SHA: ${deployedSha || "(unknown — retrieve with: git -C /app rev-parse HEAD in the portal container, or GET /api/platform/version)"}`,
    `Report: ${autoReportId || "(auto-report not filed — the crash is still in the server logs)"}`,
    "",
    "The production error message is sanitized — the REAL error is only in the server logs. Do NOT guess the cause from this screen. Steps:",
    "1. Find the real error: search the portal server logs for the digest above (e.g. docker logs dpf-portal-1 2>&1 | grep -i <digest>), or read the logs around the crash time on this route.",
    "2. Check for unapplied DB migrations: docker exec dpf-portal-1 sh -c \"cd /app && pnpm --filter @dpf/db exec prisma migrate status\" — a Prisma P2022 ColumnNotFound almost always means a migration did not run.",
    "3. Identify the actual root cause from the real error text, not from this sanitized message.",
    "4. Propose and apply a fix, or file a specific, actionable bug containing the REAL error text and root cause.",
  ].join("\n");

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(diagnosticPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the visible block below is the fallback */
    }
  }

  async function handleSubmit() {
    const reportDescription = [
      `Page: ${route || "Unknown route"}`,
      `Error: ${cleanError}`,
      "",
      description.trim() ? `User note: ${description.trim()}` : "User note: none provided",
    ].join("\n");

    try {
      const res = await fetch("/api/quality/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "user_report",
          severity: "high",
          title: cleanError.slice(0, 100) || "User report from error page",
          description: reportDescription,
          routeContext: typeof window !== "undefined" ? window.location.pathname : null,
          errorStack: error.stack?.slice(0, 20000),
          errorDigest: error.digest ?? null,
          deployedSha,
          source: "crash_boundary",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setReportId(data.reportId);
      }
    } catch { /* silent */ }
    setSubmitted(true);
  }

  // The report to surface in the escalation button — prefer the user's manual
  // submission (has their description); fall back to the auto-filed crash report.
  const escalationReportId = reportId ?? autoReportId;

  // While the skew auto-reload is in flight, show a calm one-liner instead of
  // the crash card — the page is about to be replaced by the current build.
  if (autoReloading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
        <div className="w-full max-w-[34rem] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center shadow-sm sm:p-8">
          <div
            aria-hidden="true"
            className="mx-auto mb-3 flex size-10 animate-pulse items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-2xl font-semibold text-[var(--dpf-accent)]"
          >
            ↻
          </div>
          <h2 className="mb-2 text-lg font-semibold text-[var(--dpf-text)]">
            The portal was updated
          </h2>
          <p role="status" className="text-sm leading-6 text-[var(--dpf-muted)]">
            Refreshing this page to the latest version…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-[34rem] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center shadow-sm sm:p-8">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-2xl font-semibold text-[var(--dpf-accent)]"
        >
          !
        </div>
        <h2 className="mb-2 text-lg font-semibold text-[var(--dpf-text)]">
          Something went wrong
        </h2>
        <p className="mb-5 text-sm leading-6 text-[var(--dpf-muted)]">
          The platform team has been automatically notified. You can add what you were doing below.
        </p>
        {isSkew && (
          <p className="mb-5 text-sm leading-6 text-[var(--dpf-muted)]">
            This can happen when a page stays open across a platform update. If this
            screen keeps returning after a refresh, it&apos;s worth reporting below.
          </p>
        )}

        <dl className="mb-4 grid gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-left text-xs">
          <div className="grid gap-1 sm:grid-cols-[4.5rem_1fr] sm:items-start">
            <dt className="font-medium text-[var(--dpf-muted)]">Page</dt>
            <dd className="break-words font-mono text-[var(--dpf-text)]">{route || "Unknown route"}</dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[4.5rem_1fr] sm:items-start">
            <dt className="font-medium text-[var(--dpf-muted)]">Error</dt>
            <dd className="break-words font-mono text-[var(--dpf-text)]">{cleanError}</dd>
          </div>
        </dl>

        {/* BI-B4F401B3: diagnostic prompt — collapsed by default so the primary
            CTA (add context + report to team) is the first thing a non-technical
            user sees. Developers can expand to get the AI-ready prompt. */}
        <div className="mb-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-left">
          <button
            type="button"
            onClick={() => setShowDiagnostic((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-medium text-[var(--dpf-text)]"
            aria-expanded={showDiagnostic}
          >
            <span>Developer diagnostic</span>
            <span aria-hidden="true" className="text-[var(--dpf-muted)]">
              {showDiagnostic ? "▲" : "▼"}
            </span>
          </button>
          {showDiagnostic && (
            <div className="mt-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs leading-5 text-[var(--dpf-muted)]">
                  Paste this into Claude, Codex, or Grok — it can read the server logs and fix the real error.
                </p>
                <button
                  type="button"
                  onClick={copyPrompt}
                  disabled={!prepared}
                  aria-disabled={!prepared}
                  aria-label={
                    prepared
                      ? "Copy AI diagnostic prompt to clipboard"
                      : "Preparing diagnostic prompt, please wait"
                  }
                  className="shrink-0 rounded-md border border-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-[var(--dpf-accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dpf-accent)]"
                >
                  {!prepared ? "Preparing…" : promptCopied ? "Copied!" : "Copy prompt"}
                </button>
              </div>
              <pre
                tabIndex={0}
                className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 font-mono text-[11px] leading-5 text-[var(--dpf-text)]"
              >
                {diagnosticPrompt}
              </pre>
              <span role="status" aria-live="polite" className="sr-only">
                {promptCopied ? "Diagnostic prompt copied to clipboard" : ""}
              </span>
            </div>
          )}
        </div>

        {!submitted ? (
          <div className="space-y-3 text-left">
            <label htmlFor="crash-feedback" className="block text-sm font-medium text-[var(--dpf-text)]">
              What were you doing when this happened?
            </label>
            <textarea
              id="crash-feedback"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Example: I clicked Save after changing the portal settings."
              rows={4}
              className="min-h-24 w-full resize-y rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none"
            />
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={handleSubmit}
                className="rounded-lg bg-[var(--dpf-accent)] px-5 py-2 text-sm font-medium text-white"
              >
                Send feedback
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-5 py-2 text-sm font-medium text-[var(--dpf-text)]"
              >
                Try again
              </button>
            </div>
            {/* Surface the escalation path even before the user submits their
                description — the auto-report is already filed and the non-technical
                user should be able to route it to GitHub immediately. */}
            {autoReportId && !submitted && (
              <div className="pt-1">
                <UpstreamEscalation reportId={autoReportId} />
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-[var(--dpf-muted)]">
            {reportId
              ? `Thanks! Report ${reportId} filed.`
              : "Thanks for the feedback."}
            {escalationReportId && (
              <UpstreamEscalation reportId={escalationReportId} />
            )}
            <button
              type="button"
              onClick={reset}
              className="mx-auto mt-4 block rounded-lg bg-[var(--dpf-accent)] px-5 py-2 text-sm font-medium text-white"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
