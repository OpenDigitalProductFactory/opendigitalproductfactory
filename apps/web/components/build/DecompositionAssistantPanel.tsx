// apps/web/components/build/DecompositionAssistantPanel.tsx
//
// Phase 4b/4c — operator slide-over for picking + optionally editing a
// candidate decomposition.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md (§4.2)
// BI: BI-2E6CC391.
//
// Phase 4b shipped pick-only behaviour (radio + approve + regenerate-with-hint).
// Phase 4c adds operator editing of the selected candidate before approval:
//   - Click an AC's "→" button to move it to a different child via a small
//     popover that lists the other child orders.
//   - Click a child title to rename it inline (Enter or blur saves).
//   - Edits live in a local working-copy map keyed by candidateId; the
//     original is preserved so "Reset edits" returns to the model-proposed
//     partition without re-fetching from the server.
//   - validateCandidate runs against the working copy on every change; the
//     footer shows a structured failure list inline before approve fires.
//   - The candidate passed to onApprove is the working copy (or the
//     original if no edits exist).
//
// Drag-drop was deliberately skipped here. HTML5 native DnD is fragile on
// Windows + Firefox; react-dnd / @dnd-kit add ~30KB to the bundle. Click-to-
// move covers the same capability (per spec §4.2 "drag an AC from one card
// to another" — same outcome, different gesture) with no library cost and
// no a11y regression.
//
// All colours via CSS variables; no hardcoded hex.

"use client";

import { useId, useMemo, useState } from "react";

import {
  validateCandidate,
  type DecompositionCandidate,
  type DecompositionChildScope,
  type ValidateResult,
} from "@/lib/build/decomposition-candidates";
import type { BuildDesignDoc } from "@/lib/explore/feature-build-types";

export type DecompositionAssistantPanelProps = {
  open: boolean;
  /** The parent design's acceptance criteria — referenced by index in each
   *  child scope so the panel can render the actual text per child. Also
   *  used for live-revalidating edited candidates. */
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
  /** Receives the working copy of the chosen candidate (with operator edits
   *  applied), or the unmodified original when no edits exist. */
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
  const [workingCopies, setWorkingCopies] = useState<Record<string, DecompositionCandidate>>({});
  const radioName = useId();
  const originalById = useMemo(() => {
    const m = new Map<string, DecompositionCandidate>();
    for (const c of candidates) m.set(c.candidateId, c);
    return m;
  }, [candidates]);

  // All hooks above this line — early return must come after to satisfy
  // the rules of hooks.
  if (!open) return null;

  const getCurrent = (id: string | null): DecompositionCandidate | null => {
    if (!id) return null;
    return workingCopies[id] ?? originalById.get(id) ?? null;
  };

  const selected = getCurrent(selectedId);
  const selectedIsEdited = selectedId != null && workingCopies[selectedId] != null;

  const dummyDoc: BuildDesignDoc = {
    problemStatement: "",
    reusePlan: "",
    proposedApproach: "",
    acceptanceCriteria: parentAcceptanceCriteria,
  };
  const validation: ValidateResult | null = selected
    ? validateCandidate(selected, dummyDoc)
    : null;

  const updateWorking = (id: string, next: DecompositionCandidate) => {
    setWorkingCopies((prev) => ({ ...prev, [id]: next }));
  };

  const resetEdits = (id: string) => {
    setWorkingCopies((prev) => {
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
  };

  const moveAc = (candidateId: string, acIndex: number, toChildOrder: number) => {
    const current = getCurrent(candidateId);
    if (!current) return;
    const updated: DecompositionCandidate = {
      ...current,
      childScopes: current.childScopes.map((scope) => {
        if (scope.childOrder === toChildOrder) {
          if (scope.acceptanceCriteriaIndices.includes(acIndex)) return scope;
          return {
            ...scope,
            acceptanceCriteriaIndices: [...scope.acceptanceCriteriaIndices, acIndex].sort(
              (a, b) => a - b,
            ),
          };
        }
        if (scope.acceptanceCriteriaIndices.includes(acIndex)) {
          return {
            ...scope,
            acceptanceCriteriaIndices: scope.acceptanceCriteriaIndices.filter(
              (i) => i !== acIndex,
            ),
          };
        }
        return scope;
      }),
    };
    updateWorking(candidateId, updated);
  };

  const renameChild = (candidateId: string, childOrder: number, newTitle: string) => {
    const current = getCurrent(candidateId);
    if (!current) return;
    const trimmed = newTitle.trim();
    if (trimmed.length === 0) return; // empty title would fail validate; keep prior
    const updated: DecompositionCandidate = {
      ...current,
      childScopes: current.childScopes.map((scope) =>
        scope.childOrder === childOrder ? { ...scope, title: trimmed } : scope,
      ),
    };
    updateWorking(candidateId, updated);
  };

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

  const approveBlockedByValidation = validation != null && !validation.ok;

  return (
    <div
      data-testid="decomposition-assistant-panel"
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Decomposition assistant"
    >
      <button
        type="button"
        aria-label="Close decomposition assistant"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "var(--dpf-overlay, rgba(0,0,0,0.4))" }}
      />

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
              Pick one of the proposed splits below. You can edit the selected split — click an AC's <span className="font-mono">→</span> to move it, or click a child title to rename it. Approving creates the parent Epic + the child builds atomically.
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
              {candidates.map((origC) => {
                const current = getCurrent(origC.candidateId) ?? origC;
                const isEdited = workingCopies[origC.candidateId] != null;
                const isSelected = origC.candidateId === selectedId;
                return (
                  <CandidateCard
                    key={origC.candidateId}
                    candidate={current}
                    radioName={radioName}
                    selected={isSelected}
                    isEdited={isEdited}
                    editable={isSelected}
                    onSelect={() => setSelectedId(origC.candidateId)}
                    parentAcceptanceCriteria={parentAcceptanceCriteria}
                    onMoveAc={(acIdx, toChildOrder) =>
                      moveAc(origC.candidateId, acIdx, toChildOrder)
                    }
                    onRenameChild={(childOrder, newTitle) =>
                      renameChild(origC.candidateId, childOrder, newTitle)
                    }
                    onResetEdits={() => resetEdits(origC.candidateId)}
                  />
                );
              })}
            </ul>
          )}
        </div>

        <footer
          className="flex flex-col gap-2 p-4"
          style={{ borderTop: "1px solid var(--border-default, var(--dpf-muted))" }}
        >
          {approveBlockedByValidation && validation && !validation.ok && (
            <ValidationFailureList result={validation} />
          )}
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
              {selectedIsEdited && (
                <button
                  type="button"
                  onClick={() => selectedId && resetEdits(selectedId)}
                  className="text-[11px]"
                  style={{ color: "var(--dpf-muted)" }}
                >
                  Reset edits
                </button>
              )}
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
                disabled={!selected || approving || approveBlockedByValidation}
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

function ValidationFailureList({ result }: { result: Extract<ValidateResult, { ok: false }> }) {
  return (
    <div
      data-testid="validation-failure-list"
      className="rounded border p-2 text-[11px]"
      style={{
        borderColor: "var(--border-warning-subtle, var(--dpf-warning))",
        background: "var(--surface-elevated, var(--dpf-surface))",
        color: "var(--dpf-text)",
      }}
    >
      <span className="font-semibold" style={{ color: "var(--dpf-warning)" }}>
        Edits broke the split:
      </span>
      <ul className="mt-1 list-disc pl-4">
        {result.failures.map((f, i) => (
          <li key={i} style={{ color: "var(--dpf-text-secondary)" }}>
            <span className="font-mono">[{f.code}]</span> {f.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateCard({
  candidate,
  radioName,
  selected,
  isEdited,
  editable,
  onSelect,
  parentAcceptanceCriteria,
  onMoveAc,
  onRenameChild,
  onResetEdits,
}: {
  candidate: DecompositionCandidate;
  radioName: string;
  selected: boolean;
  isEdited: boolean;
  editable: boolean;
  onSelect: () => void;
  parentAcceptanceCriteria: string[];
  onMoveAc: (acIdx: number, toChildOrder: number) => void;
  onRenameChild: (childOrder: number, newTitle: string) => void;
  onResetEdits: () => void;
}) {
  const allChildOrders = candidate.childScopes.map((s) => s.childOrder).sort((a, b) => a - b);
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
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold">{candidate.candidateId}</p>
            {isEdited && (
              <span
                data-testid="edited-badge"
                className="rounded px-1 text-[9px] font-mono"
                style={{
                  background: "var(--surface-elevated, var(--dpf-surface))",
                  color: "var(--dpf-warning)",
                }}
              >
                EDITED
              </span>
            )}
          </div>
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
              editable={editable}
              allChildOrders={allChildOrders}
              parentAcceptanceCriteria={parentAcceptanceCriteria}
              onMoveAc={onMoveAc}
              onRenameChild={onRenameChild}
            />
          ))}
      </ul>
    </li>
  );
}

function ChildScopeRow({
  scope,
  editable,
  allChildOrders,
  parentAcceptanceCriteria,
  onMoveAc,
  onRenameChild,
}: {
  scope: DecompositionChildScope;
  editable: boolean;
  allChildOrders: number[];
  parentAcceptanceCriteria: string[];
  onMoveAc: (acIdx: number, toChildOrder: number) => void;
  onRenameChild: (childOrder: number, newTitle: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(scope.title);
  const otherChildOrders = allChildOrders.filter((c) => c !== scope.childOrder);

  const commitRename = () => {
    if (titleDraft.trim().length === 0) {
      setTitleDraft(scope.title); // restore
      setRenaming(false);
      return;
    }
    if (titleDraft !== scope.title) {
      onRenameChild(scope.childOrder, titleDraft);
    }
    setRenaming(false);
  };

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
        {renaming && editable ? (
          <input
            data-testid={`child-title-input-${scope.childOrder}`}
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") {
                setTitleDraft(scope.title);
                setRenaming(false);
              }
            }}
            autoFocus
            className="flex-1 rounded border px-1 py-0.5 text-[11px] font-semibold"
            style={{
              borderColor: "var(--border-default, var(--dpf-muted))",
              background: "var(--surface-input, var(--dpf-surface))",
              color: "var(--dpf-text)",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => editable && setRenaming(true)}
            className="cursor-text text-left font-semibold disabled:cursor-default"
            disabled={!editable}
            data-testid={`child-title-${scope.childOrder}`}
            title={editable ? "Click to rename" : undefined}
          >
            {scope.title}
          </button>
        )}
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
      <ul className="mt-1 space-y-0.5 pl-1">
        {scope.acceptanceCriteriaIndices.map((idx) => (
          <li
            key={idx}
            className="flex items-start gap-1 leading-snug"
            style={{ color: "var(--dpf-text-secondary)" }}
          >
            <span className="font-mono shrink-0">[{idx}]</span>
            <span className="flex-1">
              {parentAcceptanceCriteria[idx] ?? `(AC index ${idx} out of range)`}
            </span>
            {editable && otherChildOrders.length > 0 && (
              <MoveAcMenu
                fromChildOrder={scope.childOrder}
                otherChildOrders={otherChildOrders}
                onMove={(toChildOrder) => onMoveAc(idx, toChildOrder)}
                acIdx={idx}
              />
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

function MoveAcMenu({
  fromChildOrder,
  otherChildOrders,
  onMove,
  acIdx,
}: {
  fromChildOrder: number;
  otherChildOrders: number[];
  onMove: (toChildOrder: number) => void;
  acIdx: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Move AC ${acIdx} from child ${fromChildOrder}`}
        className="rounded px-1 text-[10px]"
        style={{
          background: "var(--surface-elevated, var(--dpf-surface))",
          color: "var(--dpf-accent)",
        }}
        data-testid={`move-ac-${acIdx}-from-${fromChildOrder}`}
      >
        →
      </button>
      {open && (
        <span
          className="absolute right-0 top-5 z-10 flex flex-col gap-0.5 rounded border p-1 shadow"
          style={{
            background: "var(--surface-card, var(--dpf-surface))",
            borderColor: "var(--border-default, var(--dpf-muted))",
          }}
          role="menu"
          data-testid={`move-ac-menu-${acIdx}`}
        >
          {otherChildOrders.map((to) => (
            <button
              key={to}
              type="button"
              onClick={() => {
                onMove(to);
                setOpen(false);
              }}
              className="rounded px-2 py-0.5 text-left text-[10px] hover:opacity-80"
              style={{ color: "var(--dpf-text)" }}
              data-testid={`move-ac-${acIdx}-to-${to}`}
              role="menuitem"
            >
              Move to #{to}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
