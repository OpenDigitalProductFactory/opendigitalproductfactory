"use client";

import { useState } from "react";
import { submitReport } from "@/lib/quality-queue";

type Props = {
  routeContext: string;
  userId?: string | null;
  errorMessage?: string;
  errorStack?: string;
  source?: string;
  onClose?: () => void;
};

export function FeedbackForm({ routeContext, userId, errorMessage, errorStack, source, onClose }: Props) {
  const [type, setType] = useState<string>(errorMessage ? "runtime_error" : "user_report");
  const [description, setDescription] = useState(errorMessage ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function handleSubmit() {
    const result = await submitReport({
      type,
      title: description.slice(0, 100) || "User report",
      description,
      severity: type === "runtime_error" ? "high" : "medium",
      routeContext,
      ...(errorStack !== undefined && { errorStack }),
      source: source ?? "manual",
      ...(userId != null && { userId }),
    });
    if (result.ok && result.reportId) {
      setReportId(result.reportId);
    } else {
      setQueued(true);
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "var(--dpf-text)", fontSize: 13 }}>
        {reportId
          ? `Thanks! Report ${reportId} filed. The platform team has been notified.`
          : "Saved — will be sent when connectivity is restored."}
        {onClose && (
          <button type="button" onClick={onClose} style={{ display: "block", margin: "12px auto 0", background: "none", border: "1px solid rgba(42,42,64,0.6)", borderRadius: 6, padding: "4px 12px", color: "var(--dpf-text)", fontSize: 12, cursor: "pointer" }}>
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 12, fontSize: 13, color: "var(--dpf-text)" }}>
      <div style={{ marginBottom: 8 }}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ width: "100%", background: "rgba(15,15,26,0.8)", border: "1px solid rgba(42,42,64,0.6)", borderRadius: 6, padding: "6px 8px", color: "var(--dpf-text)", fontSize: 12 }}
        >
          <option value="runtime_error">Bug Report</option>
          <option value="feedback">Suggestion</option>
          <option value="user_report">Question</option>
        </select>
      </div>
      <div style={{ marginBottom: 8 }}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what happened or what you'd like to see..."
          rows={4}
          style={{ width: "100%", background: "rgba(15,15,26,0.8)", border: "1px solid rgba(42,42,64,0.6)", borderRadius: 6, padding: "6px 8px", color: "var(--dpf-text)", fontSize: 12, resize: "vertical" }}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!description.trim()}
          style={{ flex: 1, background: "var(--dpf-accent)", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, color: "#fff", cursor: description.trim() ? "pointer" : "not-allowed", opacity: description.trim() ? 1 : 0.5 }}
        >
          Submit
        </button>
        {onClose && (
          <button type="button" onClick={onClose} style={{ background: "none", border: "1px solid rgba(42,42,64,0.6)", borderRadius: 6, padding: "6px 12px", fontSize: 12, color: "var(--dpf-text)", cursor: "pointer" }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
