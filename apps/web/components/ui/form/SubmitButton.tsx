"use client";

// SubmitButton — the primary form action with a first-class pending state. It
// composes the shared InlineBusy affordance (spinner + announced label) instead
// of the hand-rolled "swap the button text" idiom, marks itself aria-busy while
// pending, and disables to prevent double-submit.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { cx, primaryButtonClass } from "./styles";

export type SubmitButtonProps = {
  children: ReactNode;
  /** True while the mutating action is in flight. */
  pending?: boolean;
  /** Visible + announced label during the pending state. */
  pendingLabel?: string;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick" | "className" | "disabled">;

export function SubmitButton({
  children,
  pending = false,
  pendingLabel = "Working…",
  disabled = false,
  type = "submit",
  onClick,
  className,
  ...rest
}: SubmitButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(primaryButtonClass, className)}
    >
      {pending ? <InlineBusy label={pendingLabel} tone="current" /> : children}
    </button>
  );
}
