"use client";

import { useEffect, useState } from "react";

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  const route = typeof window !== "undefined" ? window.location.pathname : "";
  const cleanError =
    error.message?.replace(/\s+/g, " ").trim().slice(0, 240) || "Unknown error";
  const [description, setDescription] = useState("");

  // Auto-report on mount (fire-and-forget)
  useEffect(() => {
    const body = {
      type: "runtime_error",
      severity: "critical",
      title: error.message?.slice(0, 200) || "Page crash",
      description: error.message,
      routeContext: typeof window !== "undefined" ? window.location.pathname : null,
      errorStack: error.stack?.slice(0, 20000),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      source: "crash_boundary",
    };
    fetch("/api/quality/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // Queue to localStorage if fetch fails
      try {
        const key = "dpf-quality-queue";
        const raw = localStorage.getItem(key);
        const queue = raw ? JSON.parse(raw) : [];
        if (Array.isArray(queue)) {
          queue.push({ ...body, queuedAt: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(queue));
        }
      } catch { /* silent */ }
    });
  }, [error]);

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
          </div>
        ) : (
          <div className="text-sm text-[var(--dpf-muted)]">
            {reportId
              ? `Thanks! Report ${reportId} filed.`
              : "Thanks for the feedback."}
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
