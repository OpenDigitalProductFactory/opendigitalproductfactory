"use client";

import { useEffect, useState } from "react";

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

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
    try {
      const res = await fetch("/api/quality/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "user_report",
          severity: "high",
          title: description.slice(0, 100) || "User report from error page",
          description,
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
    <div style={{
      minHeight: "60vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    }}>
      <div style={{
        maxWidth: 480,
        width: "100%",
        background: "rgba(26, 26, 46, 0.9)",
        border: "1px solid rgba(42, 42, 64, 0.6)",
        borderRadius: 16,
        padding: "32px 28px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>!</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "#e0e0ff", marginBottom: 8 }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginBottom: 20 }}>
          The platform team has been automatically notified.
          You can also describe what happened below.
        </p>

        {!submitted ? (
          <>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What were you doing when this happened? (optional)"
              rows={3}
              style={{
                width: "100%",
                background: "rgba(15,15,26,0.8)",
                border: "1px solid rgba(42,42,64,0.6)",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#e0e0ff",
                fontSize: 12,
                resize: "vertical",
                marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                type="button"
                onClick={handleSubmit}
                style={{
                  background: "var(--dpf-accent)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 20px",
                  fontSize: 13,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Send feedback
              </button>
              <button
                type="button"
                onClick={reset}
                style={{
                  background: "none",
                  border: "1px solid rgba(42,42,64,0.6)",
                  borderRadius: 8,
                  padding: "8px 20px",
                  fontSize: 13,
                  color: "#e0e0ff",
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
            {reportId
              ? `Thanks! Report ${reportId} filed.`
              : "Thanks for the feedback."}
            <button
              type="button"
              onClick={reset}
              style={{
                display: "block",
                margin: "16px auto 0",
                background: "var(--dpf-accent)",
                border: "none",
                borderRadius: 8,
                padding: "8px 20px",
                fontSize: 13,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
