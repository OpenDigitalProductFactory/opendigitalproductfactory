"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  addICalSubscription,
  refreshICalSubscription,
  removeICalSubscription,
  getICalSyncStatus,
} from "@/lib/actions/calendar-sync";

export function CalendarSyncPanel() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [feedUrl, setFeedUrl] = useState("");
  const [feedName, setFeedName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{
    connected: boolean;
    feedUrl: string | null;
    name: string | null;
    lastSyncAt: string | null;
    eventCount: number;
  } | null>(null);

  useEffect(() => {
    getICalSyncStatus().then(setSyncStatus);
  }, []);

  function handleAdd() {
    if (!feedUrl.trim()) return;
    startTransition(async () => {
      setMessage("Fetching calendar feed...");
      const result = await addICalSubscription({
        feedUrl: feedUrl.trim(),
        ...(feedName.trim() ? { name: feedName.trim() } : {}),
      });
      if (result.success) {
        setMessage(`Imported ${result.imported} events`);
        setShowAdd(false);
        setFeedUrl("");
        setFeedName("");
        getICalSyncStatus().then(setSyncStatus);
        router.refresh();
      } else {
        setMessage(result.error ?? "Failed");
      }
      setTimeout(() => setMessage(null), 5000);
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      setMessage("Refreshing...");
      const result = await refreshICalSubscription();
      if (result.success) {
        setMessage(`Synced ${result.imported} events`);
        getICalSyncStatus().then(setSyncStatus);
        router.refresh();
      } else {
        setMessage(result.error ?? "Refresh failed");
      }
      setTimeout(() => setMessage(null), 5000);
    });
  }

  function handleRemove() {
    if (!confirm("Remove external calendar subscription and all imported events?")) return;
    startTransition(async () => {
      const result = await removeICalSubscription();
      if (result.success) {
        setMessage(`Removed ${result.removed} events`);
        setSyncStatus({ connected: false, feedUrl: null, name: null, lastSyncAt: null, eventCount: 0 });
        router.refresh();
      } else {
        setMessage(result.error ?? "Remove failed");
      }
      setTimeout(() => setMessage(null), 5000);
    });
  }

  return (
    <div className="mt-3 p-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
          External Calendar
        </span>
        {!syncStatus?.connected && (
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10"
          >
            + Subscribe to iCal
          </button>
        )}
      </div>

      {/* Connected status */}
      {syncStatus?.connected && (
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-xs text-white">{syncStatus.name ?? "iCal Feed"}</span>
              <span className="text-[10px] text-[var(--dpf-muted)]">{syncStatus.eventCount} events</span>
            </div>
            {syncStatus.lastSyncAt && (
              <span className="text-[10px] text-[var(--dpf-muted)] ml-4">
                Last synced {new Date(syncStatus.lastSyncAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={isPending}
              onClick={handleRefresh}
              className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleRemove}
              className="text-[10px] px-2 py-0.5 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="space-y-2 mt-2">
          <input
            type="url"
            placeholder="iCal feed URL (e.g. https://calendar.google.com/...basic.ics)"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white placeholder:text-[var(--dpf-muted)]"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Name (optional)"
              value={feedName}
              onChange={(e) => setFeedName(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white placeholder:text-[var(--dpf-muted)]"
            />
            <button
              type="button"
              disabled={isPending || !feedUrl.trim()}
              onClick={handleAdd}
              className="text-[10px] px-3 py-1.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10 disabled:opacity-50"
            >
              {isPending ? "Importing..." : "Subscribe"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="text-[10px] px-2 py-1.5 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Status message */}
      {message && (
        <p className={`text-[10px] mt-2 ${message.includes("fail") || message.includes("Failed") || message.includes("Invalid") || message.includes("No events") ? "text-red-400" : "text-green-400"}`}>
          {isPending ? <span className="animate-pulse">{message}</span> : message}
        </p>
      )}
    </div>
  );
}
