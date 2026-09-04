"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { resolveAgentRoleLabel } from "@dpf/db/agent-identity";

import type { SkillProposalRow } from "@/lib/skills/proposals";
import {
  approveSkillProposalAction,
  rejectSkillProposalAction,
} from "@/lib/actions/skill-proposal-actions";

type Props = {
  skillId: string;
  currentContent: string;
  proposals: SkillProposalRow[];
};

const statusBadge: Record<string, { label: string; color: string; bg: string }> = {
  proposed: { label: "Pending", color: "var(--dpf-warning)", bg: "color-mix(in srgb, var(--dpf-warning) 12%, transparent)" },
  reviewed: { label: "Approved", color: "var(--dpf-success)", bg: "color-mix(in srgb, var(--dpf-success) 12%, transparent)" },
  rejected: { label: "Rejected", color: "var(--dpf-error)", bg: "color-mix(in srgb, var(--dpf-error) 12%, transparent)" },
};

export function SkillProposalsPanel({ skillId, currentContent, proposals }: Props) {
  if (proposals.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 6,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-2)",
          color: "var(--dpf-muted)",
          fontSize: 12,
        }}
      >
        No proposals filed against <code>{skillId}</code> yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {proposals.map((p) => (
        <ProposalRow key={p.proposalId} skillId={skillId} currentContent={currentContent} proposal={p} />
      ))}
    </div>
  );
}

function ProposalRow({
  skillId,
  currentContent,
  proposal,
}: {
  skillId: string;
  currentContent: string;
  proposal: SkillProposalRow;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const badge = statusBadge[proposal.status] ?? {
    label: proposal.status,
    color: "var(--dpf-muted)",
    bg: "var(--dpf-surface-2)",
  };

  const isActionable = proposal.status === "proposed";

  return (
    <div
      style={{
        borderRadius: 6,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-2)",
        padding: 0,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          color: "var(--dpf-text)",
        }}
      >
        <span
          style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 999,
            background: badge.bg,
            color: badge.color,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {badge.label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{proposal.title}</span>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
          {new Date(proposal.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        </span>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {proposal.threadId ? (
        <div style={evidenceLinkRow}>
          <Link
            href={`/platform/ai/skills?skill=${encodeURIComponent(skillId)}&evidenceThread=${encodeURIComponent(proposal.threadId)}#skill-evidence`}
            style={evidenceLinkStyle}
          >
            View evidence
          </Link>
          <span style={{ color: "var(--dpf-muted)" }}>
            thread <code>{proposal.threadId}</code>
          </span>
        </div>
      ) : null}

      {expanded && (
        <div style={{ padding: 12, borderTop: "1px solid var(--dpf-border)" }}>
          <p style={{ fontSize: 12, color: "var(--dpf-text)", margin: "0 0 8px 0" }}>{proposal.description}</p>
          {proposal.observedFriction && (
            <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "0 0 8px 0" }}>
              <strong>Observed friction:</strong> {proposal.observedFriction}
            </p>
          )}
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
            AI-proposed by your {resolveAgentRoleLabel(proposal.agentId)}
          </p>

          <SimpleDiff current={currentContent} proposed={proposal.proposedContent} />

          {proposal.status === "rejected" && proposal.rejectionReason && (
            <p
              style={{
                fontSize: 12,
                color: "var(--dpf-error)",
                marginTop: 12,
              }}
            >
              <strong>Rejected:</strong> {proposal.rejectionReason}
            </p>
          )}

          {isActionable && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await approveSkillProposalAction(proposal.proposalId);
                      if (!result.ok) {
                        setFeedback(`Failed: ${result.error}`);
                        return;
                      }
                      // Never report a bare success: an approval that did not
                      // reach the seed file is reverted by the next reseed
                      // (BI-5798BBA3), so say which happened.
                      const p = result.data.propagation;
                      const pr = result.data.seedPullRequest;
                      // A pull request is what makes the approval durable on an
                      // install with no writable checkout, so it leads.
                      setFeedback(
                        pr.status === "pr-opened"
                          ? `Approved. Review and merge ${pr.prUrl} to land it in the shipped skill.`
                          : p.status === "written"
                            ? `Approved, and written to ${p.path}. Commit that file so the change survives a reseed. No PR was opened (${pr.reason ?? pr.status}).`
                            : `Approved in the catalog only — NOT in the shipped skill (${pr.reason ?? p.reason ?? pr.status}). A reseed will revert it.`,
                      );
                    })
                  }
                  style={primaryBtn}
                >
                  Approve and apply
                </button>
                <button
                  type="button"
                  disabled={pending || rejectionReason.trim().length === 0}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await rejectSkillProposalAction(
                        proposal.proposalId,
                        rejectionReason.trim(),
                      );
                      setFeedback(result.ok ? "Rejected." : `Failed: ${result.error}`);
                    })
                  }
                  style={secondaryBtn}
                >
                  Reject
                </button>
              </div>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Rejection reason (required when rejecting)"
                rows={2}
                style={{
                  fontSize: 12,
                  padding: 6,
                  borderRadius: 4,
                  border: "1px solid var(--dpf-border)",
                  background: "var(--dpf-surface-1)",
                  color: "var(--dpf-text)",
                  resize: "vertical",
                }}
              />
              {feedback && (
                <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: 0 }}>{feedback}</p>
              )}
              <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0 }}>
                Refresh the page to see the new revision after approval. Submission of a rejection or
                approval requires the <code>manage_capabilities</code> role.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SimpleDiff({ current, proposed }: { current: string; proposed: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <DiffColumn label="Current" body={current} accent="var(--dpf-muted)" />
      <DiffColumn label="Proposed" body={proposed} accent="var(--dpf-accent)" />
    </div>
  );
}

function DiffColumn({ label, body, accent }: { label: string; body: string; accent: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: accent, marginBottom: 4 }}>{label}</div>
      <pre
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          color: "var(--dpf-text)",
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          padding: 8,
          borderRadius: 4,
          margin: 0,
          maxHeight: 240,
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {body}
      </pre>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  fontSize: 12,
  padding: "6px 12px",
  borderRadius: 4,
  border: "1px solid var(--dpf-accent)",
  background: "var(--dpf-accent)",
  color: "white",
  cursor: "pointer",
};

const evidenceLinkRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px 10px 12px",
  fontSize: 11,
};

const evidenceLinkStyle: CSSProperties = {
  color: "var(--dpf-accent)",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

const secondaryBtn: CSSProperties = {
  fontSize: 12,
  padding: "6px 12px",
  borderRadius: 4,
  border: "1px solid var(--dpf-border)",
  background: "var(--dpf-surface-1)",
  color: "var(--dpf-text)",
  cursor: "pointer",
};
