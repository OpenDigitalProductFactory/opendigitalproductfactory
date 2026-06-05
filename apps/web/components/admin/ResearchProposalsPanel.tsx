"use client";

import { useState, useTransition } from "react";
import {
  approveResearchProposalAction,
  declineResearchProposalAction,
} from "@/lib/actions/research-proposals";

type Proposal = {
  proposalId: string;
  topic: string;
  query: string;
  proposedBy: string;
  proposedAt: string | Date;
};

// Approval UI for scheduled AI research (BI-8A58C65A slice E). Lists pending
// proposals; Approve enqueues a real research run (results land as a draft for
// review); Decline drops it. Approval is the human gate before any web/LLM work.
export function ResearchProposalsPanel({ initial }: { initial: Proposal[] }) {
  const [proposals, setProposals] = useState<Proposal[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function act(proposalId: string, action: "approve" | "decline") {
    setError(null);
    startTransition(async () => {
      const res =
        action === "approve"
          ? await approveResearchProposalAction(proposalId)
          : await declineResearchProposalAction(proposalId);
      if (res.ok) {
        setProposals((prev) => prev.filter((p) => p.proposalId !== proposalId));
      } else {
        setError(res.error ?? "Action failed");
      }
    });
  }

  if (proposals.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
        No research proposals awaiting approval. The weekly scan will propose new ones.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
      {error && <p style={{ color: "var(--dpf-error)", fontSize: 13, margin: 0 }}>{error}</p>}
      {proposals.map((p) => (
        <div
          key={p.proposalId}
          style={{
            border: "1px solid var(--dpf-border)",
            borderRadius: 8,
            padding: "12px 14px",
            background: "var(--dpf-surface-1)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {p.topic} · proposed by {p.proposedBy}
          </div>
          <div style={{ fontSize: 14, color: "var(--dpf-text)", margin: "4px 0 10px" }}>{p.query}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => act(p.proposalId, "approve")}
              disabled={pending}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "none",
                background: "var(--dpf-accent)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              Approve &amp; research
            </button>
            <button
              type="button"
              onClick={() => act(p.proposalId, "decline")}
              disabled={pending}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid var(--dpf-border)",
                background: "transparent",
                color: "var(--dpf-text)",
                fontSize: 13,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
      <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0 }}>
        Approved research runs in the background and lands as a <strong>draft</strong> in your
        organization&apos;s knowledge for you to review before it becomes authoritative.
      </p>
    </div>
  );
}
