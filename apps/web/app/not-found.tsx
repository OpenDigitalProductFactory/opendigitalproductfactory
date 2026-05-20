import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--dpf-bg)] px-4 py-10">
      <div className="w-full max-w-[34rem] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center sm:p-8">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-base font-semibold text-[var(--dpf-accent)]"
        >
          404
        </div>
        <h1 className="mb-2 text-lg font-semibold text-[var(--dpf-text)]">
          This page could not be found
        </h1>
        <p className="mb-5 text-sm leading-6 text-[var(--dpf-muted)]">
          The link may be stale, or the route was renamed. Head back to the
          workspace and try a destination from the left rail.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/workspace"
            className="rounded-lg bg-[var(--dpf-accent)] px-5 py-2 text-sm font-medium text-white"
          >
            Back to workspace
          </Link>
          <Link
            href="/docs"
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-5 py-2 text-sm font-medium text-[var(--dpf-text)]"
          >
            Browse docs
          </Link>
        </div>
      </div>
    </div>
  );
}
