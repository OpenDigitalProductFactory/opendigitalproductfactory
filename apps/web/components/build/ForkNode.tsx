"use client";

import type { UpstreamFork, PromoteFork } from "@/lib/build-flow-state";
import { describePromoteFork, describeUpstreamFork } from "@/lib/build/release-decision";

// ─── Color tokens ───────────────────────────────────────────────────────────

/**
 * Fork-state color mapping. Amber is reserved for awaiting_operator per spec
 * §7.3 (matches A1's Platform Development CTA pattern for "action required").
 * Green = shipped, red = errored / rolled_back, gray = skipped / pending,
 * blue = scheduled, orange = in_progress.
 */
const STATE_COLOURS: Record<string, { ring: string; label: string; edge: string }> = {
  shipped:            { ring: "#22c55e", label: "#22c55e", edge: "#22c55e" },
  errored:            { ring: "#ef4444", label: "#ef4444", edge: "#ef4444" },
  rolled_back:        { ring: "#ef4444", label: "#ef4444", edge: "#ef4444" },
  scheduled:          { ring: "#3b82f6", label: "#3b82f6", edge: "#3b82f6" },
  awaiting_operator:  { ring: "#f59e0b", label: "#f59e0b", edge: "#f59e0b" },
  in_progress:        { ring: "#fb923c", label: "#fb923c", edge: "#fb923c" },
  skipped:            { ring: "var(--dpf-border)", label: "var(--dpf-muted)", edge: "var(--dpf-border)" },
  pending:            { ring: "var(--dpf-border)", label: "var(--dpf-muted)", edge: "var(--dpf-border)" },
};

// ─── Rendering ──────────────────────────────────────────────────────────────

interface ForkNodeProps {
  kind: "upstream" | "promote";
  state: string;
  primary: string;
  secondary?: string;
  href?: string;
}

function ForkNodeView({ kind, state, primary, secondary, href }: ForkNodeProps) {
  const colours = STATE_COLOURS[state] ?? STATE_COLOURS.pending!;
  const icon = iconForState(state);

  const inner = (
    <div
      className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors"
      style={{
        borderColor: colours.edge,
        background: state === "pending" || state === "skipped" ? "transparent" : `color-mix(in srgb, ${colours.ring} 10%, transparent)`,
      }}
      data-testid={`fork-node-${kind}`}
      data-fork-state={state}
    >
      <span className="text-sm leading-none" style={{ color: colours.label }}>{icon}</span>
      <div className="flex flex-col">
        <span className="font-semibold" style={{ color: colours.label }}>{primary}</span>
        {secondary && (
          <span className="text-[10px]" style={{ color: "var(--dpf-muted)" }}>
            {secondary}
          </span>
        )}
      </div>
    </div>
  );

  if (href && state === "shipped") {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="no-underline">
        {inner}
      </a>
    );
  }
  return inner;
}

function iconForState(state: string): string {
  switch (state) {
    case "shipped":             return "\u2713"; // ✓
    case "errored":
    case "rolled_back":         return "\u2717"; // ✗
    case "awaiting_operator":   return "\u26A0"; // ⚠
    case "scheduled":           return "\u23F0"; // ⏰
    case "in_progress":         return "\u25CF"; // ●
    case "skipped":
    case "pending":
    default:                    return "\u25CB"; // ○
  }
}

// ─── Public fork components ─────────────────────────────────────────────────

export function UpstreamForkNode({ fork }: { fork: UpstreamFork }) {
  const summary = describeUpstreamFork(fork);
  return (
    <ForkNodeView
      kind="upstream"
      state={fork.state}
      primary="Upstream PR"
      secondary={summary.statusLabel}
      href={fork.prUrl ?? undefined}
    />
  );
}

export function PromoteForkNode({ fork }: { fork: PromoteFork }) {
  const summary = describePromoteFork(fork);
  return (
    <ForkNodeView
      kind="promote"
      state={fork.state}
      primary="Promote to Prod"
      secondary={summary.statusLabel}
    />
  );
}
