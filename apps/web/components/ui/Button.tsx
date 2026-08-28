// apps/web/components/ui/Button.tsx
//
// Canonical action button (BI-D25ED55D, Simplify & Strengthen W5 — architecture
// pass 2026-08-16 §3.3-b). Server-usable (no hooks, no "use client") so it can
// render inside server- or client-rendered surfaces; event handlers arrive from
// the client boundary that composes it, exactly like Spinner/StatusBadge.
//
// Before this existed the accent-button class string was hand-inlined ~296
// times, and because there was no --dpf-on-accent token the label was
// `text-white` — the single largest theme-violation class (346 occurrences).
// Compose this instead of re-typing the string; the ratchet
// (scripts/check-ux-primitive-adoption.mjs) freezes the residual inline sites.
//
// When to use what (see components/ui/README.md):
//   - Button                — any standalone action button.
//   - SubmitButton (form/)  — a form's pending-aware submit (useFormStatus).
//   - primaryButtonClass    — legacy form-kit compat only; token-correct now,
//     but new code composes <Button> instead of raw class strings.
//
// Spec: docs/superpowers/specs/2026-08-16-ux-foundation-button-surface-design.md

import type { ComponentPropsWithoutRef } from "react";
import Link from "next/link";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export type ButtonLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

// All color through --dpf-* tokens (AGENTS.md §9). Solid fills pair with
// --dpf-on-accent so the label passes WCAG AA in both themes and under brand
// overrides — never text-white (the pre-token defect this component retires).
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--dpf-accent)] text-[var(--dpf-on-accent)] transition-opacity hover:opacity-90",
  secondary:
    "border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] " +
    "hover:bg-[var(--dpf-surface-1)]",
  ghost: "text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]",
  danger:
    "bg-[var(--dpf-error)] text-[var(--dpf-on-accent)] transition-opacity hover:opacity-90",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

function buttonClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  className: string,
): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-md font-medium",
    "disabled:cursor-not-allowed disabled:opacity-60",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Render a themed `<button>`. Defaults to `type="button"` so a button inside a
 * `<form>` never submits by accident — pass `type="submit"` deliberately.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, size, className)}
      {...rest}
    />
  );
}

/** Render a navigation action with the same visual contract as Button. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonLinkProps) {
  return <Link className={buttonClassName(variant, size, className)} {...rest} />;
}
