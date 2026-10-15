"use client";

// BI-051A74CE: the private link a person pastes into Google Calendar, Outlook
// or Apple Calendar to see their DPF calendar there. The link carries a secret
// token that is stored only as a hash, so it is shown once, right after it is
// created; replacing it stops the old link at once.

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/Dialog";
import {
  getCalendarFeedStatus,
  revokeCalendarFeed,
  rotateCalendarFeed,
  type CalendarFeedStatus,
} from "@/lib/actions/calendar-feed";
import { useT } from "@/lib/i18n/use-t";

export function CalendarFeedSubscribePanel() {
  const t = useT("shell");
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
        title: t("calendarFeed.replaceTitle"),
        message: t("calendarFeed.replaceMessage"),
        tone: "danger",
        confirmLabel: t("calendarFeed.replace"),
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
      title: t("calendarFeed.turnOffTitle"),
      message: t("calendarFeed.turnOffMessage"),
      tone: "danger",
      confirmLabel: t("calendarFeed.turnOff"),
    });
    if (!confirmed) return;
    startTransition(async () => {
      const res = await revokeCalendarFeed();
      if (!res.ok) { setMessage({ tone: "error", text: res.error }); return; }
      setFreshUrl(null);
      setStatus({ active: false, issuedAt: null });
      setMessage({ tone: "ok", text: t("calendarFeed.turnedOff") });
    });
  }

  async function handleCopy() {
    if (!freshUrl) return;
    try {
      await navigator.clipboard.writeText(freshUrl);
      setMessage({ tone: "ok", text: t("calendarFeed.copied") });
    } catch {
      setMessage({ tone: "error", text: t("calendarFeed.copyFailed") });
    }
  }

  return (
    <div className="mt-3 p-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-dpf-caption font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          {t("calendarFeed.heading")}
        </span>
        <div className="flex gap-1">
          <Button variant="secondary" size="sm" disabled={isPending || status === null} onClick={handleCreate}>
            {status?.active ? t("calendarFeed.replace") : t("calendarFeed.create")}
          </Button>
          {status?.active && (
            <Button variant="danger" size="sm" disabled={isPending} onClick={handleTurnOff}>
              {t("calendarFeed.turnOff")}
            </Button>
          )}
        </div>
      </div>

      <p className="text-dpf-caption text-[var(--dpf-muted)]">
        {status?.active
          ? t("calendarFeed.activeSince", { date: status.issuedAt ? new Date(status.issuedAt).toLocaleDateString() : "" })
          : t("calendarFeed.inactive")}
      </p>

      {freshUrl && (
        <div className="mt-2 space-y-1">
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              aria-label={t("calendarFeed.linkLabel")}
              value={freshUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
            />
            <Button variant="primary" size="sm" onClick={handleCopy}>
              {t("calendarFeed.copy")}
            </Button>
          </div>
          <p className="text-dpf-caption text-[var(--dpf-muted)]">{t("calendarFeed.shownOnce")}</p>
        </div>
      )}

      {message && (
        <p role="status" className={`text-dpf-caption mt-2 ${message.tone === "error" ? "text-[var(--dpf-error)]" : "text-[var(--dpf-success)]"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
