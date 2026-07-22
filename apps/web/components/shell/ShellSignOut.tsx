"use client";

import { useFormStatus } from "react-dom";
import { signOutAction } from "@/lib/actions";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";

// Common Shell Action-Result Contract (BI-9C0954D0) C3/C5: Sign out must show a
// visible result on click (not a dead click before the redirect) and present a
// ≥44px tap target. useFormStatus surfaces the in-flight state as an InlineBusy
// affordance while the server action redirects.
function SignOutSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-busy={pending}
      disabled={pending}
      className={[
        SHELL_TAP_TARGET_CLASS,
        "rounded-full px-3 text-xs text-[var(--dpf-muted)] transition-colors",
        "hover:text-[var(--dpf-text)] disabled:cursor-wait",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]",
      ].join(" ")}
    >
      {pending ? <InlineBusy label="Signing out…" size="xs" tone="current" /> : "Sign out"}
    </button>
  );
}

export function ShellSignOut() {
  return (
    <form action={signOutAction}>
      <SignOutSubmit />
    </form>
  );
}
