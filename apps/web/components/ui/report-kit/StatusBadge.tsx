// apps/web/components/ui/report-kit/StatusBadge.tsx
//
// Canonical status/severity badge for the reporting palette. Server-usable
// (no hooks, no "use client"): badges appear inside server-rendered tables and
// lists across the portal.
//
// Color comes from the intent model in ./statusColors — never raw hex.

import type { CSSProperties } from "react";

import { intentStyle, resolveIntent, type Intent } from "./statusColors";

type Variant = "soft" | "outline" | "solid";
type Size = "sm" | "md";

type IntentProps =
  | { intent: Intent; domain?: never; status?: never }
  | { intent?: never; domain: string; status: string };

export type StatusBadgeProps = IntentProps & {
  /** Visible text. Defaults to the raw `status` (or intent) when omitted. */
  label?: string;
  variant?: Variant;
  size?: Size;
  uppercase?: boolean;
  className?: string;
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[10px] leading-4",
  md: "px-2.5 py-1 text-xs leading-5",
};

function variantStyle(variant: Variant, intent: Intent): CSSProperties {
  const { fg, border, softBg } = intentStyle(intent);
  switch (variant) {
    case "solid":
      return { backgroundColor: fg, borderColor: fg, color: "var(--dpf-surface-1)" };
    case "soft":
      return { backgroundColor: softBg, borderColor: "transparent", color: fg };
    case "outline":
    default:
      return { backgroundColor: "transparent", borderColor: border, color: fg };
  }
}

/**
 * Render a status badge. Supply either an explicit `intent`, or a
 * `domain` + `status` pair that resolves through the central registry.
 */
export function StatusBadge({
  label,
  variant = "outline",
  size = "sm",
  uppercase = true,
  className = "",
  ...rest
}: StatusBadgeProps) {
  const intent: Intent =
    "intent" in rest && rest.intent
      ? rest.intent
      : resolveIntent(rest.domain as string, rest.status as string);

  const text = label ?? ("status" in rest ? rest.status : rest.intent) ?? "";

  return (
    <span
      data-intent={intent}
      className={[
        "inline-flex max-w-full items-center gap-1 rounded border font-medium",
        uppercase ? "uppercase tracking-wide" : "",
        SIZE_CLASS[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={variantStyle(variant, intent)}
    >
      <span className="truncate">{text}</span>
    </span>
  );
}
