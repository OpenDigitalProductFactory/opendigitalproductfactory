// apps/web/components/ui/report-kit/statusColors.ts
//
// Central status/severity color semantics for the reporting palette.
//
// A domain status string (e.g. "overdue", "critical") maps to a semantic
// `Intent`, and an Intent maps to DPF design tokens. This is the single place
// that defines those mappings, so individual surfaces stop re-declaring their
// own color maps (and stop bypassing tokens with raw hex).
//
// NOTE: unrelated to apps/web/lib/reporting-types.ts (compliance-posture math).

export type Intent =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "accent";

export interface IntentStyle {
  /** Foreground (text/icon) color — a CSS value, always a --dpf-* token. */
  fg: string;
  /** Border color — a CSS value, always a --dpf-* token. */
  border: string;
  /** Soft background wash derived from the foreground token via color-mix. */
  softBg: string;
}

const INTENT_TOKEN: Record<Intent, { fg: string; border: string }> = {
  success: { fg: "var(--dpf-success)", border: "var(--dpf-success)" },
  warning: { fg: "var(--dpf-warning)", border: "var(--dpf-warning)" },
  danger: { fg: "var(--dpf-error)", border: "var(--dpf-error)" },
  info: { fg: "var(--dpf-info)", border: "var(--dpf-info)" },
  accent: { fg: "var(--dpf-accent)", border: "var(--dpf-accent)" },
  neutral: { fg: "var(--dpf-muted)", border: "var(--dpf-border)" },
};

/**
 * Resolve the token-backed style for a semantic intent. Soft backgrounds use
 * color-mix so we never introduce new tokens for tints.
 */
export function intentStyle(intent: Intent): IntentStyle {
  const token = INTENT_TOKEN[intent];
  const softBg =
    intent === "neutral"
      ? "var(--dpf-surface-2)"
      : `color-mix(in srgb, ${token.fg} 12%, transparent)`;
  return { fg: token.fg, border: token.border, softBg };
}

/**
 * Per-domain status → intent registry. Adding a new domain (or status) is a
 * one-line change here rather than a new color map inside a page component.
 *
 * Keys are domain namespaces; some domains split severity vs. lifecycle status
 * (e.g. complaints) so each gets its own namespace.
 */
export const STATUS_INTENT: Record<string, Record<string, Intent>> = {
  // Finance invoice/payment lifecycle (was app/(shell)/finance STATUS_COLOURS).
  finance: {
    draft: "neutral",
    sent: "info",
    viewed: "accent",
    overdue: "danger",
    partially_paid: "warning",
    paid: "success",
    void: "neutral",
    written_off: "neutral",
  },
  // Complaints (was raw hex in ComplaintsClient — now token-backed).
  complaintSeverity: {
    low: "success",
    medium: "warning",
    high: "warning",
    critical: "danger",
  },
  complaintStatus: {
    open: "info",
    investigating: "accent",
    resolved: "success",
    closed: "neutral",
  },
  // Generic severity ramp, reusable by any surface that has none of its own.
  severity: {
    info: "info",
    low: "success",
    medium: "warning",
    high: "warning",
    critical: "danger",
  },
};

/**
 * Resolve a (domain, status) pair to an intent. Unknown domain/status falls
 * back to "neutral" so a surface never crashes on an unmapped value.
 */
export function resolveIntent(domain: string, status: string): Intent {
  return STATUS_INTENT[domain]?.[status] ?? "neutral";
}
