// (portal) not-found boundary (BI-DD5FC4FF, Simplify & Strengthen W7).
//
// Catches notFound() from the portal group's dynamic segments so the miss
// renders inside the portal layout. Server component, token-styled.

import Link from "next/link";

import { Surface } from "@/components/ui/Surface";

export default function PortalNotFound() {
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
          We couldn&apos;t find that page
        </h1>
        <p className="mb-5 text-sm leading-6 text-[var(--dpf-muted)]">
          The link may be out of date or mistyped.
        </p>
        <Link
          href="/portal"
          className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-5 py-2 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-1)]"
        >
          Back to the portal
        </Link>
      </Surface>
    </div>
  );
}
