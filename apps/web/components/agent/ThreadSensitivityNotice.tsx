"use client";
// BI-706530B2 — say out loud that this conversation is pinned to a local model.
//
// Before this, the constraint was invisible: the coworker just got slower and
// less capable, with no stated cause and nothing to do about it. The wording
// deliberately avoids the governance vocabulary (`restricted`, `local-only`,
// data-class slugs) — the reader is an operator, not a policy administrator.
//
// The action appears only when `deriveThreadSensitivityNotice` says a fresh
// conversation would actually clear the pin. Rendering it in the other cases
// would trade the owner's whole thread for no change.

import { useEffect, useState } from "react";
import { getThreadSensitivityNotice } from "@/lib/actions/thread-sensitivity";
import type { ThreadSensitivityNotice as Notice } from "@/lib/inference/thread-sensitivity-notice";

export function ThreadSensitivityNotice({
  threadId,
  messageCount,
  onStartFresh,
}: {
  threadId: string | null;
  /** Re-checked when the turn count changes: routing can change per turn. */
  messageCount: number;
  onStartFresh?: () => void;
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    if (!threadId) {
      setNotice(null);
      return;
    }
    // Best-effort: this explains a constraint, it is never the constraint, so a
    // failure here must degrade to silence rather than break the panel.
    getThreadSensitivityNotice({ threadId })
      .then((result) => {
        if (live) setNotice(result);
      })
      .catch(() => {
        if (live) setNotice(null);
      });
    return () => {
      live = false;
    };
  }, [threadId, messageCount]);

  if (!notice || dismissed) return null;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "8px 12px",
        fontSize: 11,
        lineHeight: 1.5,
        color: "var(--dpf-text)",
        background: "color-mix(in srgb, var(--dpf-accent) 8%, transparent)",
        borderBottom: "1px solid var(--dpf-border)",
      }}
    >
      <div style={{ flex: "1 1 auto" }}>
        <div style={{ fontWeight: 600 }}>{notice.headline}</div>
        <div style={{ color: "var(--dpf-muted)", marginTop: 2 }}>{notice.detail}</div>
        {notice.action && onStartFresh && (
          <button
            type="button"
            onClick={onStartFresh}
            style={{
              marginTop: 6,
              padding: "3px 8px",
              fontSize: 11,
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--dpf-accent)",
              background: "transparent",
              border: "1px solid color-mix(in srgb, var(--dpf-accent) 45%, transparent)",
            }}
          >
            {notice.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        style={{
          flex: "0 0 auto",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--dpf-muted)",
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
