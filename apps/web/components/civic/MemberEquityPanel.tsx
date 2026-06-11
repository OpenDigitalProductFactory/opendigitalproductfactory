"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retireEquity, runPatronageAllocation } from "@/lib/actions/member-equity";

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

export type MemberEquityMemberRow = {
  id: string;
  accountId: string;
  name: string;
  status: string;
  balance: number;
  entryCount: number;
};

export function MemberEquityPanel({
  members,
  fiscalYear,
}: {
  members: MemberEquityMemberRow[];
  fiscalYear: number;
}) {
  const router = useRouter();
  const [showAllocate, setShowAllocate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retireFor, setRetireFor] = useState<string | null>(null);
  const [retireAmount, setRetireAmount] = useState("");

  async function handleAllocate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await runPatronageAllocation({
      fiscalYear: Number(form.get("fiscalYear")),
      totalPool: Number(form.get("totalPool")),
      cashPct: Number(form.get("cashPct")),
      qualified: form.get("qualified") === "on",
    });
    setBusy(false);
    if (!result.ok) setError(result.message);
    else {
      setNotice(result.message);
      setShowAllocate(false);
      router.refresh();
    }
  }

  async function handleRetire(memberAccountId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await retireEquity({
      memberAccountId,
      fiscalYear,
      amount: Number(retireAmount),
    });
    setBusy(false);
    if (!result.ok) setError(result.message);
    else {
      setNotice(result.message);
      setRetireFor(null);
      setRetireAmount("");
      router.refresh();
    }
  }

  const activeMembers = members.filter((m) => m.status === "active").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--dpf-muted)]">
          {activeMembers} active members participate in allocations
        </p>
        <button
          onClick={() => setShowAllocate((v) => !v)}
          className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          {showAllocate ? "Close" : "Run Year-End Allocation"}
        </button>
      </div>

      {showAllocate && (
        <form
          onSubmit={handleAllocate}
          className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 sm:grid-cols-3"
        >
          <div>
            <label className={labelClasses}>Fiscal year *</label>
            <input name="fiscalYear" type="number" defaultValue={fiscalYear} required className={inputClasses} />
          </div>
          <div>
            <label className={labelClasses}>Total patronage pool *</label>
            <input name="totalPool" type="number" min="0.01" step="0.01" required className={inputClasses} placeholder="50000" />
          </div>
          <div>
            <label className={labelClasses}>Cash portion % *</label>
            <input name="cashPct" type="number" min="0" max="100" defaultValue="20" required className={inputClasses} />
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--dpf-text)] sm:col-span-2">
            <input name="qualified" type="checkbox" defaultChecked />
            Qualified allocation (written notice; ≥20% cash required)
          </label>
          <div className="flex justify-end sm:col-span-1">
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Allocating..." : "Allocate"}
            </button>
          </div>
          <p className="sm:col-span-3 text-[11px] text-[var(--dpf-muted)]">
            v1 allocates the pool equally across active members; patronage-basis weighting
            arrives with purchase-volume data.
          </p>
        </form>
      )}

      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}
      {notice && <p className="text-xs text-[var(--dpf-success)]">{notice}</p>}

      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--dpf-muted)]">
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Entries</th>
              <th className="px-4 py-2 font-medium text-right">Equity balance</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="border-t border-[var(--dpf-border)]/50 align-top">
                <td className="px-4 py-2 text-[var(--dpf-text)]">
                  {member.name}{" "}
                  <span className="font-mono text-xs text-[var(--dpf-muted)]">{member.accountId}</span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      member.status === "active"
                        ? "bg-[var(--dpf-success)]/15 text-[var(--dpf-success)]"
                        : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]"
                    }`}
                  >
                    {member.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-[var(--dpf-muted)]">{member.entryCount}</td>
                <td className="px-4 py-2 text-right text-[var(--dpf-text)]">{member.balance.toFixed(2)}</td>
                <td className="px-4 py-2 text-right">
                  {member.balance > 0 && (
                    <button
                      onClick={() => setRetireFor(retireFor === member.id ? null : member.id)}
                      className="px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
                    >
                      Retire
                    </button>
                  )}
                  {retireFor === member.id && (
                    <div className="mt-2 flex justify-end gap-2">
                      <input
                        value={retireAmount}
                        onChange={(e) => setRetireAmount(e.target.value)}
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="w-28 rounded border border-[var(--dpf-border)] bg-transparent px-2 py-1 text-xs text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
                        placeholder="Amount"
                      />
                      <button
                        onClick={() => handleRetire(member.id)}
                        disabled={busy || !retireAmount}
                        className="px-2 py-1 text-[11px] font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-[var(--dpf-muted)]">
                  No member accounts yet. Members appear here once accounts exist; allocations
                  target active members.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
