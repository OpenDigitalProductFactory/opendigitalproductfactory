"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/report-kit";

const PROVIDER_LOAD_TIMEOUT_MS = 15_000;

export default function ProvidersLoading() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimedOut(true), PROVIDER_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  if (timedOut) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <section
          role="alert"
          className="rounded-xl border border-[var(--dpf-warning)] bg-[var(--dpf-surface-1)] p-5 text-[var(--dpf-text)] shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-warning)]">
            Provider service unavailable
          </p>
          <h1 className="mt-2 text-lg font-semibold">We couldn&apos;t load provider data</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--dpf-muted)]">
            The local job service may still be starting. Your provider settings are safe; retry
            after a moment or check Platform Health if this keeps happening.
          </p>
          <Button className="mt-4" onClick={() => router.refresh()}>
            Try again
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main
      role="status"
      aria-live="polite"
      aria-label="Loading provider data"
      className="mx-auto max-w-5xl space-y-6 p-4 text-[var(--dpf-text)] sm:p-6"
    >
      <span className="sr-only">Loading provider data</span>
      <header className="space-y-3">
        <Skeleton width={240} height={28} />
        <Skeleton width="min(38rem, 100%)" lines={2} />
      </header>
      <section className="grid gap-4 md:grid-cols-2" aria-label="Loading providers">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={132} rounded="lg" />
        ))}
      </section>
    </main>
  );
}
