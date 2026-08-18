// (shell) not-found boundary (BI-DD5FC4FF, Simplify & Strengthen W7).
//
// Catches notFound() thrown by the 51 dynamic segments under the shell (detail
// pages calling notFound() on a missing id) so the miss renders INSIDE the
// shell layout — rail intact — instead of falling through to the bare root
// boundary. Server component, token-styled, composes ui/Surface.

import Link from "next/link";

import { Surface } from "@/components/ui/Surface";

export default function ShellNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <Surface padding="lg" className="w-full max-w-[34rem] text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-base font-semibold text-[var(--dpf-accent)]"
        >
          404
        </div>
        <h1 className="mb-2 text-lg font-semibold text-[var(--dpf-text)]">
          This record could not be found
        </h1>
        <p className="mb-5 text-sm leading-6 text-[var(--dpf-muted)]">
          It may have been removed, merged, or the link may be stale.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/workspace"
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-5 py-2 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-1)]"
          >
            Back to workspace
          </Link>
        </div>
      </Surface>
    </div>
  );
}
