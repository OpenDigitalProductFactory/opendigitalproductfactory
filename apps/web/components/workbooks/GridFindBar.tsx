"use client";

// Universal Grid & Workbooks — the Find & Replace bar (EP-GRID-WORKBOOKS,
// visual-refinement spec S5). Pure presentation: the Grid owns match computation,
// highlighting, navigation and the validated writes; this renders the Excel/browser
// -familiar controls and reports intent back through callbacks.

import { Search, ChevronUp, ChevronDown, X as XIcon } from "lucide-react";
import type { FindUiState } from "./grid-find-replace";

export interface GridFindBarProps {
  state: FindUiState;
  /** Total matches for the current query. */
  matchCount: number;
  /** Active match index, 0-based and already clamped to [0, matchCount). */
  activeIndex: number;
  /** Whether replace controls should be offered (edit rights). */
  canEdit: boolean;
  onPatch: (patch: Partial<FindUiState>) => void;
  onStep: (dir: 1 | -1) => void;
  onSetMode: (mode: "find" | "replace") => void;
  onReplaceActive: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

const OPT_ON =
  "border-[var(--dpf-accent)] text-[var(--dpf-accent)]";
const OPT_OFF =
  "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]";

export function GridFindBar({
  state,
  matchCount,
  activeIndex,
  canEdit,
  onPatch,
  onStep,
  onSetMode,
  onReplaceActive,
  onReplaceAll,
  onClose,
}: GridFindBarProps) {
  const noMatches = matchCount === 0;
  return (
    <div
      className="dpf-grid-find-bar flex flex-wrap items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1.5"
      role="search"
      aria-label="Find and replace"
    >
      <Search size={15} aria-hidden className="text-[var(--dpf-muted)]" />
      <input
        type="text"
        autoFocus
        value={state.query}
        onChange={(e) => onPatch({ query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in grid…"
        aria-label="Find text"
        className="min-w-[10rem] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-0)] px-2 py-1 text-sm text-[var(--dpf-text)]"
      />
      <span className="min-w-[4rem] text-center text-xs tabular-nums text-[var(--dpf-muted)]">
        {state.query === "" ? "—" : `${noMatches ? 0 : activeIndex + 1} / ${matchCount}`}
      </span>
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={noMatches}
        className="rounded border border-[var(--dpf-border)] p-1 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-40"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={15} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={noMatches}
        className="rounded border border-[var(--dpf-border)] p-1 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-40"
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <ChevronDown size={15} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onPatch({ matchCase: !state.matchCase })}
        aria-pressed={state.matchCase}
        className={`rounded border px-1.5 py-1 text-xs ${state.matchCase ? OPT_ON : OPT_OFF}`}
        title="Match case"
      >
        Aa
      </button>
      <button
        type="button"
        onClick={() => onPatch({ wholeCell: !state.wholeCell })}
        aria-pressed={state.wholeCell}
        className={`rounded border px-1.5 py-1 text-xs ${state.wholeCell ? OPT_ON : OPT_OFF}`}
        title="Match whole cell"
      >
        Whole cell
      </button>

      {state.mode === "replace" && canEdit && (
        <>
          <span className="mx-1 h-5 w-px bg-[var(--dpf-border)]" aria-hidden />
          <input
            type="text"
            value={state.replacement}
            onChange={(e) => onPatch({ replacement: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Replace with…"
            aria-label="Replace with"
            className="min-w-[10rem] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-0)] px-2 py-1 text-sm text-[var(--dpf-text)]"
          />
          <button
            type="button"
            onClick={onReplaceActive}
            disabled={noMatches}
            className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-40"
            title="Replace the current match"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={onReplaceAll}
            disabled={noMatches}
            className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-40"
            title="Replace every match"
          >
            Replace all
          </button>
        </>
      )}
      {state.mode === "find" && canEdit && (
        <button
          type="button"
          onClick={() => onSetMode("replace")}
          className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          title="Replace (Ctrl+H)"
        >
          Replace…
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="ml-auto rounded border border-[var(--dpf-border)] p-1 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        aria-label="Close find"
        title="Close (Esc)"
      >
        <XIcon size={15} aria-hidden />
      </button>
    </div>
  );
}
