// apps/web/components/build/DetailsDrawer.tsx
//
// Right-edge drawer that hosts the evidence surfaces that used to live in
// the Progress/Details/Docs/Preview tabs. Slides in from the workflow
// canvas region; never covers the AI Coworker rail (the parent shell
// guarantees that via layout).
//
// Per the design spec §5 + the queue-surface amendment (PR #898):
//   - Width: min(480px, 40vw) via DETAILS_DRAWER_WIDTH_CLASS.
//   - 200ms slide via getDetailsDrawerClassName; respects prefers-reduced-motion.
//   - Sections are accordion items; defaultOpen drives the initial expansion.
//     Each section supplies its own content slot — DetailsDrawer is purely
//     presentational; the BuildStudio shell composes (Progress / Brief /
//     Review / Sandbox / BS Queue) and passes them in.
//   - 24px vertical pill on the right edge of the canvas — exported as a
//     sibling component (DetailsDrawerPill) so it can sit on the canvas
//     while the drawer mounts inside the active zone.
//   - role="region" + aria-label; close button has aria-label.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import {
  BUILD_STUDIO_TEST_IDS,
  getDetailsDrawerClassName,
  getDetailsDrawerPillClassName,
} from "./build-studio-layout";

export type DetailsDrawerSection = {
  /** Stable id — used for aria-controls + the optional default-open key. */
  id: string;
  /** Accordion heading text. */
  title: string;
  /** When true, the section is expanded on mount (the BuildStudio shell sets
   *  this based on the active build's phase). */
  defaultOpen?: boolean;
  /** Section body. May render existing surfaces (BuildProgressOperationalPanel,
   *  ReviewPanel, FeatureBriefPanel, BuildSandboxCard, BS-Queue table). */
  content: ReactNode;
};

export type DetailsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  sections: readonly DetailsDrawerSection[];
  fallbackFocusRef?: RefObject<HTMLElement | null>;
};

export function DetailsDrawer({ isOpen, onClose, sections, fallbackFocusRef }: DetailsDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const initialSectionButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Track which sections are expanded. Re-seed from defaultOpen when sections
  // change (e.g. phase change reorders the default-open section).
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    for (const s of sections) {
      if (s.defaultOpen) set.add(s.id);
    }
    return set;
  }, [sections]);
  const [openIds, setOpenIds] = useState<Set<string>>(initialOpen);

  useEffect(() => {
    setOpenIds(initialOpen);
  }, [initialOpen]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      (initialSectionButtonRef.current ?? closeButtonRef.current)?.focus();
    });

    return () => {
      cancelled = true;
      const focusTarget = returnFocus?.isConnected
        ? returnFocus
        : fallbackFocusRef?.current;
      if (focusTarget?.isConnected) focusTarget.focus();
    };
  }, [fallbackFocusRef, isOpen]);

  // Esc to close — only when drawer is open, capture-phase so it wins over
  // nested inputs.
  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === "undefined") return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isOpen, onClose]);

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside
      ref={drawerRef}
      role="region"
      aria-label="Build details"
      aria-hidden={!isOpen}
      inert={!isOpen}
      data-testid={BUILD_STUDIO_TEST_IDS.detailsDrawer}
      data-open={isOpen ? "true" : "false"}
      className={getDetailsDrawerClassName(isOpen)}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--dpf-border)] px-3 py-2">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">
          Build details
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close details drawer"
          onClick={onClose}
          className="rounded p-1 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          ×
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {sections.length === 0 && (
          <p className="px-3 py-3 text-xs text-[var(--dpf-muted)]">No details for this build.</p>
        )}
        {sections.map((section) => {
          const open = openIds.has(section.id);
          const headerId = `details-drawer-${section.id}-header`;
          const panelId = `details-drawer-${section.id}-panel`;
          const sectionTestId =
            section.id === "bs-queue" ? BUILD_STUDIO_TEST_IDS.detailsDrawerQueue : `details-drawer-section-${section.id}`;
          return (
            <section
              key={section.id}
              data-testid={sectionTestId}
              data-section-id={section.id}
              data-open={open ? "true" : "false"}
              className="border-b border-[var(--dpf-border)]"
            >
              <h3 className="m-0">
                <button
                  ref={section.defaultOpen ? initialSectionButtonRef : undefined}
                  type="button"
                  id={headerId}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggle(section.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
                >
                  <span>{section.title}</span>
                  <span aria-hidden="true" className="text-[var(--dpf-muted)]">
                    {open ? "▾" : "▸"}
                  </span>
                </button>
              </h3>
              {open && (
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={headerId}
                  className="px-3 py-2 text-xs text-[var(--dpf-text)]"
                >
                  {section.content}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

export type DetailsDrawerPillProps = {
  isOpen: boolean;
  onClick: () => void;
};

/**
 * Thin 24-px vertical pill on the right edge of the workflow canvas. Opens
 * (or closes) the DetailsDrawer. Lives next to the canvas — NOT inside the
 * drawer — so it's always reachable when the drawer is closed.
 */
export function DetailsDrawerPill({ isOpen, onClick }: DetailsDrawerPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isOpen ? "Close build details drawer" : "Open build details drawer"}
      aria-expanded={isOpen}
      data-testid={BUILD_STUDIO_TEST_IDS.detailsDrawerPill}
      className={getDetailsDrawerPillClassName()}
    >
      <span className="rotate-180" style={{ writingMode: "vertical-rl" }}>
        Details
      </span>
    </button>
  );
}
