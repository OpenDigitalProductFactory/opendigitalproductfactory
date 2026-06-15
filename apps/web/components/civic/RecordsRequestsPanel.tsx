"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createRecordsRequest,
  updateRecordsRequestStatus,
} from "@/lib/actions/civic-governance";

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

const STATUS_CHIPS: Record<string, string> = {
  submitted: "bg-[var(--dpf-info)]/15 text-[var(--dpf-info)]",
  "in-progress": "bg-[var(--dpf-warning)]/15 text-[var(--dpf-warning)]",
  fulfilled: "bg-[var(--dpf-success)]/15 text-[var(--dpf-success)]",
  "partially-fulfilled": "bg-[var(--dpf-success)]/15 text-[var(--dpf-success)]",
  denied: "bg-[var(--dpf-error)]/15 text-[var(--dpf-error)]",
  withdrawn: "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
};

export type RecordsRequestRow = {
  id: string;
  requestId: string;
  requesterName: string;
  requesterEmail: string | null;
  description: string;
  receivedAt: string;
  responseDueAt: string;
  status: string;
  denialReason: string | null;
};

function daysLeft(dueIso: string): number {
  return Math.ceil((new Date(dueIso).getTime() - Date.now()) / 86_400_000);
}

export function RecordsRequestsPanel({ requests }: { requests: RecordsRequestRow[] }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [denyFor, setDenyFor] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(id);
    setError(null);
    const result = await fn();
    setBusy(null);
    if (!result.ok) setError(result.message);
    else {
      setDenyFor(null);
      setDenialReason("");
      router.refresh();
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run("create", () =>
      createRecordsRequest({
        requesterName: form.get("requesterName") as string,
        requesterEmail: (form.get("requesterEmail") as string) || undefined,
        description: form.get("description") as string,
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
          {showCreate ? "Close" : "Log Request"}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 sm:grid-cols-2"
        >
          <div>
            <label className={labelClasses}>Requester name *</label>
            <input name="requesterName" required className={inputClasses} />
          </div>
          <div>
            <label className={labelClasses}>Requester email</label>
            <input name="requesterEmail" type="email" className={inputClasses} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClasses}>Records requested *</label>
            <textarea
              name="description"
              required
              rows={3}
              className={inputClasses}
              placeholder="Copies of council meeting minutes, January–March"
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busy === "create"}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === "create" ? "Logging..." : "Log"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}

      <ul className="space-y-2">
        {requests.map((r) => {
          const open = r.status === "submitted" || r.status === "in-progress";
          const remaining = daysLeft(r.responseDueAt);
          return (
            <li key={r.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIPS[r.status] ?? STATUS_CHIPS.submitted}`}>
                  {r.status.replace(/-/g, " ")}
                </span>
                <span className="text-xs font-mono text-[var(--dpf-muted)]">{r.requestId}</span>
                <span className="text-sm font-medium text-[var(--dpf-text)]">{r.requesterName}</span>
                {open && (
                  <span
                    className={`ml-auto rounded px-2 py-0.5 text-[11px] font-medium ${
                      remaining < 0
                        ? "bg-[var(--dpf-error)]/15 text-[var(--dpf-error)]"
                        : remaining <= 3
                          ? "bg-[var(--dpf-warning)]/15 text-[var(--dpf-warning)]"
                          : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]"
                    }`}
                  >
                    {remaining < 0 ? `${-remaining}d overdue` : `due in ${remaining}d`}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">{r.description}</p>
              {r.denialReason && (
                <p className="mt-1 text-xs text-[var(--dpf-error)]">Denied: {r.denialReason}</p>
              )}
              {open && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.status === "submitted" && (
                    <button
                      onClick={() => run(r.id, () => updateRecordsRequestStatus(r.id, "in-progress"))}
                      disabled={busy === r.id}
                      className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                    >
                      Start
                    </button>
                  )}
                  <button
                    onClick={() => run(r.id, () => updateRecordsRequestStatus(r.id, "fulfilled"))}
                    disabled={busy === r.id}
                    className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-success)] hover:border-[var(--dpf-success)] disabled:opacity-50"
                  >
                    Fulfill
                  </button>
                  <button
                    onClick={() => setDenyFor(denyFor === r.id ? null : r.id)}
                    className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-error)] hover:border-[var(--dpf-error)]"
                  >
                    Deny
                  </button>
                </div>
              )}
              {denyFor === r.id && (
                <div className="mt-2 space-y-2">
                  <input
                    value={denialReason}
                    onChange={(e) => setDenialReason(e.target.value)}
                    className={inputClasses}
                    placeholder="Statutory exemption cited (required)"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() =>
                        run(r.id, () => updateRecordsRequestStatus(r.id, "denied", { denialReason }))
                      }
                      disabled={busy === r.id}
                      className="px-2 py-1 text-[11px] font-medium rounded bg-[var(--dpf-error)] text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Confirm denial
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {requests.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--dpf-border)] p-6 text-center text-sm text-[var(--dpf-muted)]">
            No records requests logged.
          </li>
        )}
      </ul>
    </div>
  );
}
