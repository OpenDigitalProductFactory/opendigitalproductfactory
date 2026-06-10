"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  approveMeetingMinutes,
  cancelGovernanceMeeting,
  createGovernanceMeeting,
  markMeetingHeld,
  publishMeetingAgenda,
  recordMeetingMinutes,
} from "@/lib/actions/civic-governance";

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";
const chipClasses: Record<string, string> = {
  scheduled: "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  "agenda-published": "bg-[var(--dpf-info)]/15 text-[var(--dpf-info)]",
  held: "bg-[var(--dpf-warning)]/15 text-[var(--dpf-warning)]",
  "minutes-recorded": "bg-[var(--dpf-accent)]/15 text-[var(--dpf-accent)]",
  "minutes-approved": "bg-[var(--dpf-success)]/15 text-[var(--dpf-success)]",
  cancelled: "bg-[var(--dpf-error)]/15 text-[var(--dpf-error)]",
};

export type MeetingRow = {
  id: string;
  meetingId: string;
  bodyType: string;
  title: string;
  scheduledAt: string;
  location: string | null;
  status: string;
  agendaPublishedAt: string | null;
  minutesRecordedAt: string | null;
};

const BODY_TYPES = ["council", "board", "committee", "annual-meeting"] as const;

export function CivicMeetingsPanel({ meetings }: { meetings: MeetingRow[] }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [composeFor, setComposeFor] = useState<{ id: string; kind: "agenda" | "minutes" } | null>(null);
  const [composeText, setComposeText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(id);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) setError(result.message);
    else {
      setComposeFor(null);
      setComposeText("");
      router.refresh();
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run("create", () =>
      createGovernanceMeeting({
        bodyType: form.get("bodyType") as string,
        title: form.get("title") as string,
        scheduledAt: form.get("scheduledAt") as string,
        location: (form.get("location") as string) || undefined,
      }),
    );
    setShowCreate(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          {showCreate ? "Close" : "Schedule Meeting"}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <label className={labelClasses}>Title *</label>
            <input name="title" required className={inputClasses} placeholder="Regular Council Meeting" />
          </div>
          <div>
            <label className={labelClasses}>Body *</label>
            <select name="bodyType" required className={inputClasses}>
              {BODY_TYPES.map((b) => (
                <option key={b} value={b}>{b.replace(/-/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Date & time *</label>
            <input name="scheduledAt" type="datetime-local" required className={inputClasses} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClasses}>Location</label>
            <input name="location" className={inputClasses} placeholder="Town Hall, Council Chambers" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busy === "create"}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === "create" ? "Scheduling..." : "Schedule"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}

      <ul className="space-y-2">
        {meetings.map((m) => (
          <li key={m.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${chipClasses[m.status] ?? chipClasses.scheduled}`}>
                {m.status.replace(/-/g, " ")}
              </span>
              <span className="text-[11px] uppercase tracking-wide text-[var(--dpf-muted)]">{m.bodyType.replace(/-/g, " ")}</span>
              <span className="text-sm font-medium text-[var(--dpf-text)]">{m.title}</span>
              <span className="ml-auto text-xs text-[var(--dpf-muted)]">
                {new Date(m.scheduledAt).toLocaleString()} {m.location ? `· ${m.location}` : ""}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {m.status === "scheduled" && (
                <button
                  onClick={() => setComposeFor({ id: m.id, kind: "agenda" })}
                  className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
                >
                  Publish agenda
                </button>
              )}
              {m.status === "agenda-published" && (
                <button
                  onClick={() => run(m.id, () => markMeetingHeld(m.id))}
                  disabled={busy === m.id}
                  className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                >
                  Mark held
                </button>
              )}
              {m.status === "held" && (
                <button
                  onClick={() => setComposeFor({ id: m.id, kind: "minutes" })}
                  className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
                >
                  Record minutes
                </button>
              )}
              {m.status === "minutes-recorded" && (
                <button
                  onClick={() => run(m.id, () => approveMeetingMinutes(m.id))}
                  disabled={busy === m.id}
                  className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                >
                  Approve minutes
                </button>
              )}
              {!["cancelled", "minutes-approved"].includes(m.status) && (
                <button
                  onClick={() => run(m.id, () => cancelGovernanceMeeting(m.id))}
                  disabled={busy === m.id}
                  className="px-2 py-1 text-[11px] rounded text-[var(--dpf-error)] hover:underline disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
            {composeFor?.id === m.id && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  rows={5}
                  className={inputClasses}
                  placeholder={composeFor.kind === "agenda" ? "1. Call to order\n2. Public comment\n3. ..." : "Attendees, motions, votes, decisions..."}
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setComposeFor(null)}
                    className="px-2 py-1 text-[11px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                  >
                    Discard
                  </button>
                  <button
                    onClick={() =>
                      run(m.id, () =>
                        composeFor.kind === "agenda"
                          ? publishMeetingAgenda(m.id, composeText)
                          : recordMeetingMinutes(m.id, composeText),
                      )
                    }
                    disabled={busy === m.id}
                    className="px-2 py-1 text-[11px] font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {composeFor.kind === "agenda" ? "Publish" : "Record"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {meetings.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--dpf-border)] p-6 text-center text-sm text-[var(--dpf-muted)]">
            No meetings yet. Schedule the first council or board meeting.
          </li>
        )}
      </ul>
    </div>
  );
}
