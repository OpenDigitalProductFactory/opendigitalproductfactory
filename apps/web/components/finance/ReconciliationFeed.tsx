"use client";

// apps/web/components/finance/ReconciliationFeed.tsx

import { useState } from "react";
import Link from "next/link";

interface Transaction {
  id: string;
  transactionDate: string;
  description: string;
  amount: number;
  reference: string | null;
  matchStatus: string;
}

interface Candidate {
  id: string;
  paymentRef: string;
  amount: number;
  receivedAt: string;
  confidence: number;
  matchReasons: string[];
}

interface Props {
  bankAccountId: string;
  initialTransactions: Transaction[];
  totalCount: number;
}

type TxState = "idle" | "loading-suggestions" | "suggestions-open" | "confirming" | "skipped" | "matched";

interface TxEntry {
  tx: Transaction;
  state: TxState;
  candidates: Candidate[];
  highConfidenceMatch: Candidate | null;
  error: string | null;
}

export function ReconciliationFeed({ bankAccountId, initialTransactions, totalCount }: Props) {
  const [entries, setEntries] = useState<TxEntry[]>(() =>
    initialTransactions.map((tx) => ({
      tx,
      state: "idle",
      candidates: [],
      highConfidenceMatch: null,
      error: null,
    })),
  );

  const matchedCount = entries.filter((e) => e.state === "matched").length;
  const pendingCount = entries.filter((e) => e.state !== "matched" && e.state !== "skipped").length;

  function updateEntry(id: string, patch: Partial<TxEntry>) {
    setEntries((prev) =>
      prev.map((e) => (e.tx.id === id ? { ...e, ...patch } : e)),
    );
  }

  async function loadSuggestions(txId: string) {
    updateEntry(txId, { state: "loading-suggestions", error: null });

    try {
      const res = await fetch(`/api/v1/finance/bank-accounts/${bankAccountId}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest", transactionId: txId }),
      });

      const json = await res.json();

      if (!res.ok) {
        updateEntry(txId, { state: "idle", error: json.message ?? "Failed to load suggestions" });
        return;
      }

      const candidates: Candidate[] = (json.data?.candidates ?? json.candidates ?? []).map(
        (c: Record<string, unknown>) => ({
          id: c.id as string,
          paymentRef: c.paymentRef as string,
          amount: c.amount as number,
          receivedAt: c.receivedAt as string,
          confidence: c.confidence as number,
          matchReasons: (c.matchReasons as string[]) ?? [],
        }),
      );

      const highConfidence = candidates.find((c) => c.confidence >= 70) ?? null;

      updateEntry(txId, {
        state: "suggestions-open",
        candidates,
        highConfidenceMatch: highConfidence,
      });
    } catch {
      updateEntry(txId, { state: "idle", error: "Network error. Please try again." });
    }
  }

  async function confirmMatch(txId: string, paymentId: string) {
    updateEntry(txId, { state: "confirming", error: null });

    try {
      const res = await fetch(`/api/v1/finance/bank-accounts/${bankAccountId}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "match", transactionId: txId, paymentId }),
      });

      const json = await res.json();

      if (!res.ok) {
        updateEntry(txId, {
          state: "suggestions-open",
          error: json.message ?? "Failed to match transaction",
        });
        return;
      }

      updateEntry(txId, { state: "matched" });
    } catch {
      updateEntry(txId, {
        state: "suggestions-open",
        error: "Network error. Please try again.",
      });
    }
  }

  const formatMoney = (amount: number) =>
    Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-GB");

  return (
    <div>
      {/* Running tally */}
      <div className="mb-6 p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">
            Progress
          </p>
          <p className="text-sm text-[var(--dpf-text)]">
            <span style={{ color: "#4ade80" }}>{matchedCount}</span> of{" "}
            <span className="text-[var(--dpf-text)]">{initialTransactions.length}</span>{" "}
            matched
            {pendingCount > 0 && (
              <span className="text-[var(--dpf-muted)]"> · {pendingCount} remaining</span>
            )}
          </p>
        </div>
        <Link
          href="/finance/banking/rules"
          className="text-xs text-[var(--dpf-accent)] hover:underline"
        >
          Create Rule →
        </Link>
      </div>

      {/* Transaction cards */}
      <div className="flex flex-col gap-4">
        {entries.map((entry) => {
          const { tx, state, candidates, highConfidenceMatch, error } = entry;
          const amount = tx.amount;
          const isMatched = state === "matched";
          const isSkipped = state === "skipped";

          return (
            <div
              key={tx.id}
              className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] overflow-hidden"
              style={
                isMatched
                  ? { borderColor: "#4ade8040", opacity: 0.6 }
                  : isSkipped
                    ? { opacity: 0.5 }
                    : undefined
              }
            >
              {/* Transaction header */}
              <div className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-[var(--dpf-text)] truncate">
                      {tx.description}
                    </p>
                    {isMatched && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ color: "#4ade80", backgroundColor: "#4ade8020" }}
                      >
                        matched
                      </span>
                    )}
                    {isSkipped && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ color: "#8888a0", backgroundColor: "#8888a020" }}
                      >
                        skipped
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-[10px] text-[var(--dpf-muted)]">
                      {formatDate(tx.transactionDate)}
                    </p>
                    {tx.reference && (
                      <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                        {tx.reference}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p
                    className="text-base font-bold font-mono"
                    style={{ color: amount >= 0 ? "#4ade80" : "#ef4444" }}
                  >
                    {amount >= 0 ? "+" : ""}
                    {formatMoney(amount)}
                  </p>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div
                  className="mx-4 mb-3 p-2 rounded text-xs"
                  style={{ color: "#ef4444", backgroundColor: "#ef444410" }}
                >
                  {error}
                </div>
              )}

              {/* Actions */}
              {!isMatched && !isSkipped && (
                <div className="px-4 pb-4">
                  {/* High confidence quick-match */}
                  {highConfidenceMatch && state === "suggestions-open" && (
                    <div
                      className="mb-3 p-3 rounded-lg border flex items-center justify-between gap-3"
                      style={{ borderColor: "#4ade8040", backgroundColor: "#4ade8008" }}
                    >
                      <div>
                        <p className="text-xs font-medium" style={{ color: "#4ade80" }}>
                          High confidence match
                        </p>
                        <p className="text-[10px] text-[var(--dpf-muted)]">
                          {highConfidenceMatch.paymentRef} · £{formatMoney(highConfidenceMatch.amount)}
                        </p>
                      </div>
                      <button
                        onClick={() => confirmMatch(tx.id, highConfidenceMatch.id)}
                        disabled={state === "confirming"}
                        className="px-3 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-50"
                        style={{ backgroundColor: "#4ade80", color: "#000" }}
                      >
                        OK — Match
                      </button>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    {state === "idle" && (
                      <>
                        <button
                          onClick={() => loadSuggestions(tx.id)}
                          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
                        >
                          Match
                        </button>
                        <button
                          onClick={() => updateEntry(tx.id, { state: "skipped" })}
                          className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                        >
                          Skip
                        </button>
                      </>
                    )}

                    {state === "loading-suggestions" && (
                      <p className="text-xs text-[var(--dpf-muted)]">Loading suggestions…</p>
                    )}

                    {state === "confirming" && (
                      <p className="text-xs text-[var(--dpf-muted)]">Matching…</p>
                    )}

                    {state === "suggestions-open" && (
                      <button
                        onClick={() => updateEntry(tx.id, { state: "skipped" })}
                        className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                      >
                        Skip for now
                      </button>
                    )}
                  </div>

                  {/* Candidates list */}
                  {state === "suggestions-open" && candidates.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
                        {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
                      </p>
                      <div className="flex flex-col gap-2">
                        {candidates.map((c) => (
                          <div
                            key={c.id}
                            className="p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors cursor-pointer group"
                            onClick={() => confirmMatch(tx.id, c.id)}
                          >
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div>
                                <p className="text-xs font-medium text-[var(--dpf-text)] group-hover:text-[var(--dpf-accent)] transition-colors">
                                  {c.paymentRef}
                                </p>
                                <p className="text-[10px] text-[var(--dpf-muted)]">
                                  {formatDate(c.receivedAt)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-mono text-[var(--dpf-text)]">
                                  £{formatMoney(c.amount)}
                                </p>
                                <p
                                  className="text-[9px]"
                                  style={{ color: c.confidence >= 70 ? "#4ade80" : c.confidence >= 40 ? "#fbbf24" : "#8888a0" }}
                                >
                                  {c.confidence}% match
                                </p>
                              </div>
                            </div>

                            {/* Confidence bar */}
                            <div className="h-1 rounded-full bg-[var(--dpf-border)] overflow-hidden mb-2">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${c.confidence}%`,
                                  backgroundColor:
                                    c.confidence >= 70
                                      ? "#4ade80"
                                      : c.confidence >= 40
                                        ? "#fbbf24"
                                        : "#8888a0",
                                }}
                              />
                            </div>

                            {/* Match reasons */}
                            {c.matchReasons.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {c.matchReasons.map((reason, i) => (
                                  <span
                                    key={i}
                                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                                    style={{ color: "#8888a0", backgroundColor: "#8888a015" }}
                                  >
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {state === "suggestions-open" && candidates.length === 0 && (
                    <p className="mt-3 text-xs text-[var(--dpf-muted)]">
                      No matching payments found. You may need to{" "}
                      <Link
                        href="/finance/banking/rules"
                        className="text-[var(--dpf-accent)] hover:underline"
                      >
                        create a rule
                      </Link>{" "}
                      or record the payment manually.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
