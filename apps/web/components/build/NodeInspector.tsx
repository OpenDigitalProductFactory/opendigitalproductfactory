// apps/web/components/build/NodeInspector.tsx
//
// Anchored inspector overlay that opens inside the workflow region when a
// graph node is clicked. NEVER displaces the AI Coworker rail.
//
// Per the design spec §2 and the chief-architect review:
//   - role="dialog" + aria-modal="false" so the coworker rail stays reachable.
//   - Position computed by getInspectorPlacement (lib/build/node-inspector-placement.ts).
//   - Authoritative bounds are the GRAPH CONTAINER, NOT the viewport.
//   - Focus trap is inspector-only (sentinel pair) — not a page-level trap.
//   - Esc / click-outside / re-click-anchor close. Focus returns to the trigger.
//   - Expand handle toggles a larger overlay capped to the container — never
//     escapes into the coworker rail.
//   - All transitions gated on prefers-reduced-motion.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { BUILD_STUDIO_TEST_IDS, getNodeInspectorClassName } from "./build-studio-layout";
import {
  getInspectorPlacement,
  type InspectorSide,
  type PlacementInput,
} from "@/lib/build/node-inspector-placement";

const DEFAULT_INSPECTOR_WIDTH = 340;
const DEFAULT_INSPECTOR_HEIGHT = 380;
const DEFAULT_GAP = 8;

/** A minimal "rect-like" shape — accepts both real DOMRect and plain objects from tests. */
type RectLike = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;

export type NodeInspectorProps = {
  /** Stable identifier for the inspector instance — used for aria-labelledby + close detection. */
  nodeId: string;
  /** Human-readable title used as the dialog's accessible name. */
  title: string;
  /** Bounding rect of the clicked node, viewport-relative. */
  anchorRect: RectLike;
  /** Bounding rect of the graph container, viewport-relative. Authoritative bounds. */
  containerRect: RectLike;
  /** containerRef.scrollTop so the inspector tracks scroll. */
  containerScrollTop?: number;
  /** Optional dimension overrides — defaults are 340x380 (compact). */
  inspectorWidth?: number;
  inspectorHeight?: number;
  /** Body content rendered between the header and the action row. */
  children?: ReactNode;
  /** Optional primary + secondary actions rendered in the footer of the inspector. */
  actions?: ReactNode;
  /** Optional "Ask coworker about this step" handler. When provided, renders an
   *  Ask-coworker button in the footer. */
  onAskCoworker?: () => void;
  /** Called when the inspector should close: Esc, click-outside, programmatic close. */
  onClose: () => void;
};

export function NodeInspector({
  nodeId,
  title,
  anchorRect,
  containerRect,
  containerScrollTop = 0,
  inspectorWidth = DEFAULT_INSPECTOR_WIDTH,
  inspectorHeight = DEFAULT_INSPECTOR_HEIGHT,
  children,
  actions,
  onAskCoworker,
  onClose,
}: NodeInspectorProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusableRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const [expanded, setExpanded] = useState(false);

  // ── Placement ─────────────────────────────────────────────────────────
  // Recompute on every prop change (anchor / container / scroll / size). For
  // expanded mode, the size grows — we size to a generous fraction of the
  // container and let the placement helper clamp inside.
  const effectiveSize = useMemo(() => {
    if (!expanded) return { w: inspectorWidth, h: inspectorHeight };
    // Expanded: cap at 80% of container, never overflow.
    const w = Math.max(inspectorWidth, Math.floor(containerRect.width * 0.8) - DEFAULT_GAP * 2);
    const h = Math.max(inspectorHeight, Math.floor(containerRect.height * 0.8) - DEFAULT_GAP * 2);
    return { w, h };
  }, [expanded, inspectorWidth, inspectorHeight, containerRect.width, containerRect.height]);

  const placement = useMemo(() => {
    const input: PlacementInput = {
      nodeRect: anchorRect,
      containerRect,
      containerScrollTop,
      inspectorW: effectiveSize.w,
      inspectorH: effectiveSize.h,
      gap: DEFAULT_GAP,
    };
    return getInspectorPlacement(input);
  }, [anchorRect, containerRect, containerScrollTop, effectiveSize.w, effectiveSize.h]);

  // ── Focus management ─────────────────────────────────────────────────
  // Save the previously-focused element on mount and restore on unmount.
  // Focus the inspector's first focusable element after mount so keyboard
  // users land inside the dialog.
  useEffect(() => {
    if (typeof document === "undefined") return;
    previouslyFocusedRef.current = document.activeElement;
    // Defer focus to after the dialog is in the DOM.
    const handle = window.requestAnimationFrame(() => {
      firstFocusableRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(handle);
      const prev = previouslyFocusedRef.current;
      if (prev && prev instanceof HTMLElement) {
        // Restore focus to the trigger on close. Fall through to body if the
        // trigger is no longer attached (e.g. graph re-rendered).
        if (document.contains(prev)) prev.focus();
      }
    };
  }, []);

  // ── Esc to close ──────────────────────────────────────────────────────
  // Mount on open, unmount on close. Capture phase so it wins over text
  // inputs inside the inspector.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // ── Click outside to close ────────────────────────────────────────────
  // Listens on document mousedown. If the click is outside the dialog AND
  // outside any element marked as a graph node (data-graph-node attribute),
  // close. Re-clicking the same node is detected by the parent BuildStudio,
  // not here — this hook only handles "click off the graph entirely".
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (dialogRef.current?.contains(target)) return; // click inside dialog — keep open
      // Don't close on clicks that land on graph nodes — the parent toggles
      // the inspector for those (re-click closes via onClose).
      if (target.closest("[data-graph-node]")) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // ── Focus trap (sentinel pair) ───────────────────────────────────────
  // Tab from the last focusable wraps to the first; Shift+Tab from the
  // first wraps to the last. Inspector-only — the rest of the page is
  // still reachable via standard browser focus order.
  const handleFirstSentinelFocus = useCallback(() => {
    lastFocusableRef.current?.focus();
  }, []);
  const handleLastSentinelFocus = useCallback(() => {
    firstFocusableRef.current?.focus();
  }, []);

  // ── Render style ──────────────────────────────────────────────────────
  const style: CSSProperties = {
    top: placement.top,
    left: placement.left,
    width: effectiveSize.w,
    height: effectiveSize.h,
  };

  const labelledById = `node-inspector-title-${nodeId}`;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledById}
      data-testid={BUILD_STUDIO_TEST_IDS.nodeInspector}
      data-node-id={nodeId}
      data-side={placement.side as InspectorSide}
      data-expanded={expanded ? "true" : "false"}
      style={style}
      className={[
        getNodeInspectorClassName(),
        "motion-reduce:transition-none",
      ].join(" ")}
    >
      {/* Sentinel: wrap focus back to the last interactive element on shift+tab from the start. */}
      <span
        tabIndex={0}
        aria-hidden="true"
        data-testid="node-inspector-sentinel-start"
        onFocus={handleFirstSentinelFocus}
      />

      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--dpf-border)] px-3 py-2">
        <h3
          id={labelledById}
          className="m-0 min-w-0 truncate text-xs font-semibold text-[var(--dpf-text)]"
        >
          {title}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          <button
            ref={firstFocusableRef}
            type="button"
            data-testid={BUILD_STUDIO_TEST_IDS.nodeInspectorExpand}
            aria-label={expanded ? "Collapse inspector" : "Expand inspector"}
            aria-pressed={expanded}
            onClick={() => setExpanded((p) => !p)}
            className="rounded p-1 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            {expanded ? "↙" : "↗"}
          </button>
          <button
            type="button"
            aria-label="Close inspector"
            onClick={onClose}
            className="rounded p-1 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            ×
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs text-[var(--dpf-text)]">
        {children}
      </div>

      {(actions || onAskCoworker) && (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--dpf-border)] px-3 py-2">
          {actions}
          {onAskCoworker && (
            <button
              ref={lastFocusableRef}
              type="button"
              onClick={onAskCoworker}
              data-testid="node-inspector-ask-coworker"
              className="inline-flex items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
            >
              Ask coworker about this step
            </button>
          )}
        </footer>
      )}

      {/* Sentinel: wrap focus back to the first interactive element on tab from the end. */}
      <span
        tabIndex={0}
        aria-hidden="true"
        data-testid="node-inspector-sentinel-end"
        onFocus={handleLastSentinelFocus}
      />
    </div>
  );
}
