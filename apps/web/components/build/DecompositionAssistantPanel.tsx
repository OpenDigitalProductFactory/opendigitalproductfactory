// apps/web/components/build/DecompositionAssistantPanel.tsx
//
// Phase 4b — operator-facing slide-over for picking a candidate decomposition.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md (§4.2)
// BI: BI-2E6CC391.
//
// Scope for this MVP:
//   - Display 2-4 candidates as cards. Operator radio-selects one and clicks
//     "Approve" → invokes the supplied onApprove handler with the chosen
//     candidate (which calls the approve_decomposition MCP tool upstream).
//   - "Reject all + regenerate" calls onRegenerate, optionally with an
//     operator hint typed into a small input.
//   - "Cancel" / overlay click closes the panel.
//
// Deferred to Phase 4c:
//   - Drag ACs between children
//   - Rename child titles inline
//   - Reorder children
//
// All colours via CSS variables; no hardcoded hex. The component is
// presentational — all I/O is via the props (onApprove, onRegenerate,
// onClose). The MCP tool wrappers live one layer up in the page route or
// the upgraded DecompositionGateBanner.

"use client";

import { useId, useState } from "react";

import type {
  DecompositionCandidate,
  DecompositionChildScope,
} from "@/lib/build/decomposition-candidates";
import type { BuildDesignDoc } from "@/lib/explore/feature-build-types";

export type DecompositionAssistantPanelProps = {
  open: boolean;
  /** The parent design's acceptance criteria — referenced by index in each
   *  child scope so the panel can render the actual text per child. */
  parentAcceptanceCriteria: string[];
  /** Candidates returned by propose_decomposition. */
  candidates: DecompositionCandidate[];
  /** Disables Approve when true (e.g. while approve_decomposition is in flight). */
  approving?: boolean;
  /** Disables Regenerate + closes input when true (e.g. while propose is in flight). */
  regenerating?: boolean;
  /** Banner-driven entry point may carry the parent design title for header copy. */
  parentBuildTitle?: string;
  /** Optional decomposition decision text used in the panel sub-header. */
  decisionLabel?: "decompose-recommended" | "decompose-required";
  onApprove: (candidate: DecompositionCandidate) => void;
  onRegenerate: (operatorHint: string) => void;
  onClose: () => void;
};

export function DecompositionAssistantPanel(props: DecompositionAssistantPanelProps) {
  const {
    open,
    candidates,
    approving,
    regenerating,
    parentAcceptanceCriteria,
    parentBuildTitle,
    decisionLabel,
    onApprove,
    onRegenerate,
    onClose,
  } = props;

  const [selectedId, setSelectedId] = useState<string | null>(
    candidates[0]?.candidateId ?? null,
  );
  const [hintOpen, setHintOpen] = useState(false);
  const [hint, setHint] = useState("");
  const radioName = useId();

  if (!open) return null;

  const selected = candidates.find((c) => c.candidateId === selectedId) ?? null;

  const handleApprove = () => {
    if (!selected || approving) return;
    onApprove(selected);
  };

  const handleRegenerate = () => {
    if (regenerating) return;
    onRegenerate(hint.trim());
    setHint("");
    setHintOpen(false);
  };

  return (
    <div
      data-testid="decomposition-assistant-panel"
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Decomposition assistant"
    >
      {/* overlay */}
      <button
        type="button"
        aria-label="Close decomposition assistant"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "var(--dpf-overlay, rgba(0,0,0,0.4))" }}
      />

      {/* slide-over */}
      <aside
        className="relative ml-auto flex h-full w-full max-w-2xl flex-col shadow-2xl"
        style={{
          background: "var(--surface-canvas, var(--dpf-surface))",
          color: "var(--dpf-text)",
          borderLeft: "1px solid var(--border-default, var(--dpf-muted))",
        }}
      >
        <header
          className="flex items-start justify-between p-4"
          style={{ borderBottom: "1px solid var(--border-default, var(--dpf-muted))" }}
        >
          <div>
            <h2 className="text-base font-semibold">Decomposition assistant</h2>
            {parentBuildTitle && (
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--dpf-text-secondary)" }}
              >
                {parentBuildTitle}
                {decisionLabel && (
                  <span style={{ color: "var(--dpf-muted)" }}>
                    {" "}— {decisionLabel === "decompose-required" ? "decomposition required" : "decomposition recommended"}
                  </span>
                )}
              </p>
            )}
            <p
              className="mt-1 text-xs"
              style={{ color: "var(--dpf-text-secondary)" }}
            >
              Pick one of the proposed splits below. Each card is a partition of the parent design's acceptance criteria into 2-4 smaller builds. Approving creates the parent Epic + the child builds atomically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-3 rounded p-1 text-sm"
            style={{ color: "var(--dpf-muted)" }}
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {candidates.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-3" role="radiogroup" aria-label="Candidate decompositions">
              {candidates.map((c) => (
                <CandidateCard
                  key={c.candidateId}
                  candidate={c}
                  radioName={radioName}
                  selected={c.candidateId === selectedId}
                  onSelect={() => setSelectedId(c.candidateId)}
                  parentAcceptanceCriteria={parentAcceptanceCriteria}
                />
              ))}
            </ul>
          )}
        </div>

        <footer
          className="flex flex-col gap-2 p-4"
          style={{ borderTop: "1px solid var(--border-default, var(--dpf-muted))" }}
        >
          {hintOpen && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Optional hint (e.g. 'ship the ledger separately')"
                className="flex-1 rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: "var(--border-default, var(--dpf-muted))",
                  background: "var(--surface-input, var(--dpf-surface))",
                  color: "var(--dpf-text)",
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setHintOpen(false);
                  setHint("");
                }}
                className="text-[10px]"
                style={{ color: "var(--dpf-muted)" }}
              >
                cancel
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={hintOpen ? handleRegenerate : () => setHintOpen(true)}
              disabled={regenerating}
              className="text-xs underline disabled:opacity-50"
              style={{ color: "var(--dpf-accent)" }}
            >
              {regenerating
                ? "Regenerating…"
                : hintOpen
                  ? "Regenerate with hint"
                  : "Reject all + regenerate"}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1 text-xs"
                style={{
                  background: "transparent",
                  color: "var(--dpf-text-secondary)",
                  border: "1px solid var(--border-default, var(--dpf-muted))",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={!selected || approving}
                className="rounded px-3 py-1 text-xs font-semibold disabled:opacity-50"
                style={{
                  background: "var(--dpf-accent)",
                  color: "var(--dpf-on-accent, white)",
                }}
              >
                {approving ? "Approving…" : "Approve selected"}
              </button>
            </div>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded border p-4 text-center text-xs"
      style={{
        borderColor: "var(--border-default, var(--dpf-muted))",
        color: "var(--dpf-text-secondary)",
      }}
    >
      No candidates available yet. Click "Reject all + regenerate" with a hint to generate the first set.
    </div>
  );
}

function CandidateCard({
  candidate,
  radioName,
  selected,
  onSelect,
  parentAcceptanceCriteria,
}: {
  candidate: DecompositionCandidate;
  radioName: string;
  selected: boolean;
  onSelect: () => void;
  parentAcceptanceCriteria: string[];
}) {
  return (
    <li
      data-testid={`candidate-card-${candidate.candidateId}`}
      className="rounded-md border p-3"
      style={{
        background: selected
          ? "var(--surface-card-emphasis, var(--surface-elevated, var(--dpf-surface)))"
          : "var(--surface-card, var(--dpf-surface))",
        borderColor: selected
          ? "var(--dpf-accent)"
          : "var(--border-default, var(--dpf-muted))",
      }}
    >
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name={radioName}
          value={candidate.candidateId}
          checked={selected}
          onChange={onSelect}
          className="mt-0.5"
          aria-label={`Select ${candidate.candidateId}`}
        />
        <div className="flex-1">
          <p className="text-xs font-semibold">{candidate.candidateId}</p>
          <p
            className="mt-0.5 text-[11px] leading-snug"
            style={{ color: "var(--dpf-text-secondary)" }}
          >
            {candidate.rationale}
          </p>
        </div>
      </label>
      <ul className="mt-2 space-y-1.5">
        {candidate.childScopes
          .slice()
          .sort((a, b) => a.childOrder - b.childOrder)
          .map((scope) => (
            <ChildScopeRow
              key={scope.childOrder}
              scope={scope}
              parentAcceptanceCriteria={parentAcceptanceCriteria}
            />
          ))}
      </ul>
    </li>
  );
}

function ChildScopeRow({
  scope,
  parentAcceptanceCriteria,
}: {
  scope: DecompositionChildScope;
  parentAcceptanceCriteria: string[];
}) {
  return (
    <li
      data-testid={`child-scope-${scope.childOrder}`}
      className="rounded border p-2 text-[11px]"
      style={{
        borderColor: "var(--border-default, var(--dpf-muted))",
        background: "var(--surface-canvas, transparent)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded px-1 text-[10px] font-mono"
          style={{
            background: "var(--surface-elevated, var(--dpf-surface))",
            color: "var(--dpf-text-secondary)",
          }}
        >
          #{scope.childOrder}
        </span>
        <span className="font-semibold">{scope.title}</span>
        {scope.dependsOn.length > 0 && (
          <span
            className="text-[10px]"
            style={{ color: "var(--dpf-muted)" }}
          >
            depends on #{scope.dependsOn.join(", #")}
          </span>
        )}
      </div>
      {scope.summary && (
        <p
          className="mt-0.5 leading-snug"
          style={{ color: "var(--dpf-text-secondary)" }}
        >
          {scope.summary}
        </p>
      )}
      <ul className="mt-1 list-disc pl-4">
        {scope.acceptanceCriteriaIndices.map((idx) => (
          <li
            key={idx}
            className="leading-snug"
            style={{ color: "var(--dpf-text-secondary)" }}
          >
            <span className="font-mono">[{idx}]</span>{" "}
            {parentAcceptanceCriteria[idx] ?? `(AC index ${idx} out of range)`}
          </li>
        ))}
      </ul>
    </li>
  );
}

// Re-export the BuildDesignDoc type purely for downstream wiring convenience.
export type { BuildDesignDoc };
