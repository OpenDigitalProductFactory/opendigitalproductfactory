"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeStorefrontServiceLine,
  restoreStorefrontServiceLine,
  purgeRemovedServiceLine,
} from "@/lib/storefront/service-line-actions";
import { intentStyle } from "@/components/ui/report-kit/statusColors";
import type { SetupTask, GeneratedContentGroup } from "@/lib/storefront/setup-model";

interface Props {
  storefrontId: string;
  steps: SetupTask[];
  summary: { completeCount: number; totalCount: number };
  /** Active secondary lines — shown read-only; add/remove lives in ServiceLinesPanel. */
  activeLines: GeneratedContentGroup[];
  /** Removed-but-retained lines — the recovery surface (restore / purge). */
  retainedLines: GeneratedContentGroup[];
}

const STATUS_INTENT = {
  complete: "success",
  attention: "warning",
  "not-started": "neutral",
} as const;

const STATUS_LABEL = {
  complete: "Done",
  attention: "Needs attention",
  "not-started": "Not started",
} as const;

type Feedback = { tone: "success" | "error"; message: string; undo?: () => void } | null;

export function StorefrontSetupPanel({ storefrontId, steps, summary, activeLines, retainedLines }: Props) {
  const router = useRouter();
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const advancedCount = activeLines.length + retainedLines.length;
  const generatedTotals = [...activeLines, ...retainedLines].reduce(
    (acc, g) => ({ items: acc.items + g.itemsGenerated, sections: acc.sections + g.sectionsGenerated }),
    { items: 0, sections: 0 },
  );

  return (
    <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Task-first setup steps ─────────────────────────────────────────── */}
      <section className="border border-[var(--dpf-border)]" style={{ borderRadius: 10, overflow: "hidden" }}>
        <header
          className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          style={{ padding: "14px 20px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}
        >
          <div className="text-[var(--dpf-text)]" style={{ fontSize: 14, fontWeight: 700 }}>
            Set up your storefront
          </div>
          <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12 }}>
            {summary.completeCount} of {summary.totalCount} steps done
          </div>
        </header>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </ol>
      </section>

      {/* ── Generated content inventory + recovery — hidden until opened ────── */}
      {advancedCount > 0 && (
        <section className="border border-[var(--dpf-border)]" style={{ borderRadius: 10, overflow: "hidden" }}>
          <button
            onClick={() => setRecoveryOpen((v) => !v)}
            aria-expanded={recoveryOpen}
            className="bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
            style={{
              width: "100%",
              border: "none",
              padding: "14px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              cursor: "pointer",
              font: "inherit",
              textAlign: "left",
            }}
          >
            <span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Generated content &amp; recovery</span>
              <span className="text-[var(--dpf-muted)]" style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                {activeLines.length} active service line{activeLines.length !== 1 ? "s" : ""}
                {retainedLines.length > 0 ? ` · ${retainedLines.length} removed (retained)` : ""} ·{" "}
                {generatedTotals.items} items · {generatedTotals.sections} sections auto-created.
              </span>
            </span>
            <span className="text-[var(--dpf-muted)]" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              {recoveryOpen ? "Hide ▲" : "Open ▼"}
            </span>
          </button>

          {recoveryOpen && (
            <GeneratedContentRecovery
              storefrontId={storefrontId}
              activeLines={activeLines}
              retainedLines={retainedLines}
              onChanged={() => router.refresh()}
            />
          )}
        </section>
      )}
    </div>
  );
}

function StepRow({ step }: { step: SetupTask }) {
  const style = intentStyle(STATUS_INTENT[step.status]);
  return (
    <li
      className="border-b border-[var(--dpf-border)]"
      style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 20px" }}
    >
      <span
        aria-hidden
        style={{ marginTop: 4, width: 10, height: 10, borderRadius: "50%", background: style.fg, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <a href={step.href} className="text-[var(--dpf-text)]" style={{ fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            {step.title}
          </a>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              padding: "2px 6px",
              borderRadius: 4,
              background: style.softBg,
              color: style.fg,
              border: `1px solid ${style.border}`,
            }}
          >
            {STATUS_LABEL[step.status]}
          </span>
        </div>
        <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
          {step.description}
        </div>
        {step.hint && (
          <a href={step.href} className="text-[var(--dpf-accent)]" style={{ fontSize: 12, marginTop: 4, display: "inline-block", textDecoration: "none" }}>
            {step.hint} →
          </a>
        )}
      </div>
    </li>
  );
}

// ── Recovery: restore / purge removed lines, each with preview + feedback ─────

interface ConfirmState {
  kind: "restore" | "purge";
  title: string;
  affected: { items: number; sections: number };
  note: string;
  destructive: boolean;
  run: () => Promise<void>;
}

function useUndoableRemove(storefrontId: string, onChanged: () => void, setFeedback: (f: Feedback) => void) {
  const [, startTransition] = useTransition();
  return (compositionId: string, name: string) =>
    startTransition(async () => {
      const r = await removeStorefrontServiceLine(storefrontId, compositionId);
      if ("error" in r) setFeedback({ tone: "error", message: r.error });
      else setFeedback({ tone: "success", message: `Removed “${name}” again — its content is retained.` });
      onChanged();
    });
}

function GeneratedContentRecovery({
  storefrontId,
  activeLines,
  retainedLines,
  onChanged,
}: {
  storefrontId: string;
  activeLines: GeneratedContentGroup[];
  retainedLines: GeneratedContentGroup[];
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const reRemove = useUndoableRemove(storefrontId, onChanged, setFeedback);

  function execute() {
    if (!confirm) return;
    const c = confirm;
    startTransition(async () => {
      try {
        await c.run();
      } finally {
        setConfirm(null);
        onChanged();
      }
    });
  }

  function prepareRestore(line: GeneratedContentGroup) {
    setFeedback(null);
    setConfirm({
      kind: "restore",
      title: `Restore “${line.name}”`,
      affected: { items: line.itemsGenerated, sections: line.sectionsGenerated },
      note: "Reactivates the retained items. Sections stay hidden until you reveal them. You can remove it again afterwards.",
      destructive: false,
      run: async () => {
        const res = await restoreStorefrontServiceLine(storefrontId, line.compositionId);
        if ("error" in res) setFeedback({ tone: "error", message: res.error });
        else
          setFeedback({
            tone: "success",
            message: `Restored “${line.name}” — ${res.affected.items} items reactivated.`,
            undo: () => reRemove(line.compositionId, line.name),
          });
      },
    });
  }

  function preparePurge(line: GeneratedContentGroup) {
    setFeedback(null);
    setConfirm({
      kind: "purge",
      title: `Permanently remove “${line.name}”`,
      affected: { items: line.itemsGenerated, sections: line.sectionsGenerated },
      note: "Deletes the retained items and sections for good. This cannot be undone.",
      destructive: true,
      run: async () => {
        const res = await purgeRemovedServiceLine(storefrontId, line.compositionId);
        if ("error" in res) setFeedback({ tone: "error", message: res.error });
        else
          setFeedback({
            tone: "success",
            message: `Permanently removed “${line.name}” (${res.affected.items} items, ${res.affected.sections} sections deleted).`,
          });
      },
    });
  }

  return (
    <div className="border-t border-[var(--dpf-border)]" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      {feedback && (
        <div
          role="status"
          style={{
            fontSize: 12,
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${feedback.tone === "success" ? "var(--dpf-success)" : "var(--dpf-error)"}`,
            background: `color-mix(in srgb, ${feedback.tone === "success" ? "var(--dpf-success)" : "var(--dpf-error)"} 10%, transparent)`,
            color: "var(--dpf-text)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span>{feedback.message}</span>
          {feedback.undo && (
            <button
              onClick={feedback.undo}
              disabled={isPending}
              className="text-[var(--dpf-accent)]"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, textDecoration: "underline" }}
            >
              Undo
            </button>
          )}
        </div>
      )}

      {activeLines.length > 0 && (
        <div>
          <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Active
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeLines.map((line) => (
              <LineRow
                key={line.compositionId}
                line={line}
                badge={line.crossCategory ? { label: "Other industry", intent: "warning" } : null}
                actions={[]}
              />
            ))}
          </div>
          <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginTop: 6 }}>
            Add or remove active lines in the Service lines panel below.
          </div>
        </div>
      )}

      {retainedLines.length > 0 && (
        <div>
          <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Removed — content retained
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {retainedLines.map((line) => (
              <LineRow
                key={line.compositionId}
                line={line}
                badge={{ label: "Retained", intent: "neutral" }}
                actions={[
                  { label: "Restore", accessibleLabel: `Restore ${line.name} line`, intent: "accent", onClick: () => prepareRestore(line), disabled: isPending },
                  { label: "Remove permanently", accessibleLabel: `Permanently remove ${line.name} line`, intent: "danger", onClick: () => preparePurge(line), disabled: isPending },
                ]}
              />
            ))}
          </div>
        </div>
      )}

      {confirm && <ConfirmPanel confirm={confirm} isPending={isPending} onCancel={() => setConfirm(null)} onConfirm={execute} />}
    </div>
  );
}

function ConfirmPanel({
  confirm,
  isPending,
  onCancel,
  onConfirm,
}: {
  confirm: ConfirmState;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const accent = confirm.destructive ? "var(--dpf-error)" : "var(--dpf-accent)";
  return (
    <div
      role="dialog"
      aria-label={confirm.title}
      className="border"
      style={{
        borderColor: accent,
        borderRadius: 8,
        padding: "14px 16px",
        background: `color-mix(in srgb, ${accent} 8%, transparent)`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="text-[var(--dpf-text)]" style={{ fontSize: 14, fontWeight: 700 }}>{confirm.title}</div>
      <div className="text-[var(--dpf-text)]" style={{ fontSize: 12 }}>
        Affects <strong>{confirm.affected.items}</strong> item{confirm.affected.items !== 1 ? "s" : ""} and{" "}
        <strong>{confirm.affected.sections}</strong> section{confirm.affected.sections !== 1 ? "s" : ""}.
      </div>
      <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, lineHeight: 1.5 }}>{confirm.note}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={onConfirm}
          disabled={isPending}
          className="text-white"
          style={{ background: accent, padding: "7px 16px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600, cursor: isPending ? "wait" : "pointer" }}
        >
          {isPending ? "Working…" : confirm.destructive ? "Delete permanently" : "Confirm"}
        </button>
        <button
          onClick={onCancel}
          disabled={isPending}
          className="border border-[var(--dpf-border)] text-[var(--dpf-text)]"
          style={{ background: "transparent", padding: "7px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function LineRow({
  line,
  badge,
  actions,
}: {
  line: GeneratedContentGroup;
  badge: { label: string; intent: "warning" | "neutral" | "accent" } | null;
  actions: { label: string; accessibleLabel: string; intent: "danger" | "accent"; onClick: () => void; disabled: boolean }[];
}) {
  return (
    <div
      className="border border-[var(--dpf-border)]"
      style={{ borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
    >
      <div style={{ flex: 1, minWidth: 160 }}>
        <div className="text-[var(--dpf-text)]" style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          {line.name}
          {badge && <Badge label={badge.label} intent={badge.intent} />}
        </div>
        <div className="text-[var(--dpf-muted)]" style={{ fontSize: 12, marginTop: 2 }}>
          {line.itemsGenerated} items · {line.sectionsGenerated} sections
        </div>
      </div>
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {actions.map((a) => {
            const style = intentStyle(a.intent);
            return (
              <button
                key={a.label}
                onClick={a.onClick}
                disabled={a.disabled}
                aria-label={a.accessibleLabel}
                className="border"
                style={{
                  borderColor: style.border,
                  color: style.fg,
                  background: "transparent",
                  padding: "5px 12px",
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: a.disabled ? "not-allowed" : "pointer",
                  opacity: a.disabled ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Badge({ label, intent }: { label: string; intent: "warning" | "neutral" | "accent" }) {
  const style = intentStyle(intent);
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "1px 6px",
        borderRadius: 4,
        background: style.softBg,
        color: style.fg,
        border: `1px solid ${style.border}`,
      }}
    >
      {label}
    </span>
  );
}
