"use client";

// BI-051A74CE: the private link a person pastes into Google Calendar, Outlook
// or Apple Calendar to see their DPF calendar there. The link carries a secret
// token that is stored only as a hash, so it is shown once, right after it is
// created; replacing it stops the old link at once.

import { useEffect, useState, useTransition } from "react";
import { confirmDialog } from "@/components/ui/Dialog";
import {
  getCalendarFeedStatus,
  revokeCalendarFeed,
  rotateCalendarFeed,
  type CalendarFeedStatus,
} from "@/lib/actions/calendar-feed";

export function CalendarFeedSubscribePanel() {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<CalendarFeedStatus | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    getCalendarFeedStatus().then((res) => { if (res.ok) setStatus(res.data); });
  }, []);

  async function handleCreate() {
    if (status?.active) {
      const confirmed = await confirmDialog({
        title: "Replace subscription link",
        message: "Calendar apps using the current link stop updating. You will need to add the new link to them.",
        tone: "danger",
        confirmLabel: "Replace link",
      });
      if (!confirmed) return;
    }
    startTransition(async () => {
      const res = await rotateCalendarFeed();
      if (!res.ok) { setMessage({ tone: "error", text: res.error }); return; }
      setFreshUrl(`${window.location.origin}${res.data.path}`);
      setStatus({ active: true, issuedAt: new Date().toISOString() });
      setMessage(null);
    });
  }

  async function handleTurnOff() {
    const confirmed = await confirmDialog({
      title: "Turn off subscription link",
      message: "Calendar apps using this link stop updating.",
      tone: "danger",
      confirmLabel: "Turn off",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const res = await revokeCalendarFeed();
      if (!res.ok) { setMessage({ tone: "error", text: res.error }); return; }
      setFreshUrl(null);
      setStatus({ active: false, issuedAt: null });
      setMessage({ tone: "ok", text: "Subscription link turned off" });
    });
  }

  async function handleCopy() {
    if (!freshUrl) return;
    try {
      await navigator.clipboard.writeText(freshUrl);
      setMessage({ tone: "ok", text: "Link copied" });
    } catch {
      setMessage({ tone: "error", text: "Copy failed: select the link and copy it" });
    }
  }

  return (
    <div className="mt-3 p-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          Subscribe from another calendar app
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={isPending || status === null}
            onClick={handleCreate}
            className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10 disabled:opacity-50"
          >
            {status?.active ? "Replace link" : "Create link"}
          </button>
          {status?.active && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleTurnOff}
              className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-error)]/20 text-[var(--dpf-error)] hover:bg-[var(--dpf-error)]/10 disabled:opacity-50"
            >
              Turn off
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-[var(--dpf-muted)]">
        {status?.active
          ? `A private link is active${status.issuedAt ? ` since ${new Date(status.issuedAt).toLocaleDateString()}` : ""}. It shows only what your role can see. Anyone with the link can read it.`
          : "Create a private link to see this calendar in Google Calendar, Outlook or Apple Calendar. Older links that used your account id no longer work."}
      </p>

      {freshUrl && (
        <div className="mt-2 space-y-1">
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              aria-label="Private calendar subscription link"
              value={freshUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-2 py-1.5 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="text-[10px] px-3 py-1.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10"
            >
              Copy
            </button>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)]">Copy it now. For your security it is shown only once.</p>
        </div>
      )}

      {message && (
        <p className={`text-[10px] mt-2 ${message.tone === "error" ? "text-[var(--dpf-error)]" : "text-[var(--dpf-success)]"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
