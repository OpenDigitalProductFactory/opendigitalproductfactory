// apps/web/components/ui/report-kit/Notice.tsx
//
// Canonical inline callout / notice for the reporting palette. Generalizes the
// ~25 hand-rolled `border-l-4` callout blocks across the portal into one
// token-backed primitive. Server-usable (pure, no hooks).
//
// Every color flows through the intent model in ./statusColors — never raw hex.

import type { CSSProperties } from "react";

import { intentStyle, type Intent } from "./statusColors";

/**
 * Friendly variant names for the four common callout tones. Each maps onto a
 * semantic `Intent`, so the color still resolves through the one registry.
 */
export type NoticeVariant = "info" | "warn" | "success" | "error";

const VARIANT_INTENT: Record<NoticeVariant, Intent> = {
  info: "info",
  warn: "warning",
  success: "success",
  error: "danger",
};

const VARIANT_ICON: Record<NoticeVariant, string> = {
  info: "ℹ",
  warn: "⚠",
  success: "✓",
  error: "✕",
};

export interface NoticeProps {
  /** Tone of the callout. Defaults to `info`. */
  variant?: NoticeVariant;
  /** Optional bold heading above the body. */
  title?: React.ReactNode;
  /** Body content. */
  children?: React.ReactNode;
  /**
   * Leading glyph. Defaults to a per-variant symbol; pass `false` to hide it,
   * or any node to override.
   */
  icon?: React.ReactNode | false;
  className?: string;
}

/**
 * A left-accented callout. Border + heading take the variant's intent color;
 * the background is a soft wash of the same token.
 */
export function Notice({
  variant = "info",
  title,
  children,
  icon,
  className = "",
}: NoticeProps) {
  const intent = VARIANT_INTENT[variant];
  const { fg, border, softBg } = intentStyle(intent);

  const style: CSSProperties = {
    borderLeftColor: border,
    borderLeftWidth: "4px",
    backgroundColor: softBg,
  };

  const glyph = icon === false ? null : (icon ?? VARIANT_ICON[variant]);

  return (
    <div
      role="note"
      data-intent={intent}
      className={[
        "flex gap-2 rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {glyph ? (
        <span aria-hidden="true" className="mt-px shrink-0" style={{ color: fg }}>
          {glyph}
        </span>
      ) : null}
      <div className="min-w-0 space-y-0.5">
        {title ? (
          <p className="font-medium" style={{ color: fg }}>
            {title}
          </p>
        ) : null}
        {children ? (
          <div className="text-[var(--dpf-text)]">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
