"use client";

import { useState, useTransition } from "react";

import { confirmDialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/report-kit";
import { decideFederatedProposalAction } from "@/lib/actions/federation-proposals";

export interface FederationProposalRow {
  proposalId: string;
  incidentKey: string;
  overallDecision: string;
  status: string;
  actionCount: number;
  createdAtISO: string;
}

type Flash = { kind: "success" | "error"; text: string } | null;

export function FederationProposalsClient({ rows }: { rows: FederationProposalRow[] }) {
  const [flash, setFlash] = useState<Flash>(null);
  const [isPending, startTransition] = useTransition();

  function onDecide(row: FederationProposalRow, decision: "approve" | "reject") {
    setFlash(null);
    startTransition(async () => {
      const ok = await confirmDialog({
        title: decision === "approve" ? "Approve remediation" : "Reject remediation",
        message:
          decision === "approve"
            ? `Approve the proposed remediation for ${row.incidentKey}? Approved actions execute on your own runner.`
            : `Reject the proposed remediation for ${row.incidentKey}?`,
        confirmLabel: decision === "approve" ? "Approve" : "Reject",
      });
      if (!ok) return;
      const result = await decideFederatedProposalAction(row.proposalId, decision);
      setFlash(
        result.ok
          ? { kind: "success", text: `Proposal ${result.status}.` }
          : { kind: "error", text: `Failed: ${result.message}` },
      );
    });
  }

  return (
    <div className="space-y-4">
      {flash && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{
            borderColor: flash.kind === "success" ? "var(--dpf-success)" : "var(--dpf-error)",
            color: flash.kind === "success" ? "var(--dpf-success)" : "var(--dpf-error)",
            backgroundColor: "var(--dpf-surface-1)",
          }}
        >
          {flash.text}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Incident</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Band gate</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Actions</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Status</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Decide</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-[var(--dpf-muted)]">
                  No remediation proposals. They arrive over a federation link from a managing peer.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.proposalId} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                <td className="p-2 font-mono text-xs text-[var(--dpf-muted)]">{row.incidentKey}</td>
                <td className="p-2 text-[var(--dpf-muted)]">{row.overallDecision}</td>
                <td className="p-2 text-[var(--dpf-muted)]">{row.actionCount}</td>
                <td className="p-2">
                  <StatusBadge domain="federatedProposalStatus" status={row.status} />
                </td>
                <td className="p-2">
                  {row.status === "proposed" ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => onDecide(row, "approve")}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                        style={{ backgroundColor: "var(--dpf-success)" }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => onDecide(row, "reject")}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                        style={{ backgroundColor: "var(--dpf-error)" }}
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--dpf-muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
