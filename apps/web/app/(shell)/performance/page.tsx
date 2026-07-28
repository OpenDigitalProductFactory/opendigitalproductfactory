import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/report-kit";
import { loadBusinessPerformance } from "@/lib/performance/business-performance-provider";

export const metadata: Metadata = {
  title: "Performance",
  description: "Business results, trends, and operating drivers for owners and managers.",
};

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const performance = await loadBusinessPerformance();

  return (
    <main
      className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6"
      data-component="business-performance-home"
      data-source={performance.source}
    >
      <header className="space-y-1" data-dpf-lead>
        <h1 className="text-xl font-semibold text-[var(--dpf-text)]">Performance</h1>
        <p className="max-w-3xl text-sm text-[var(--dpf-text-secondary)]">
          Review how the business is doing over time.
        </p>
      </header>

      <EmptyState
        title="Connect a source to see performance"
        description="No history source is connected. We will not show made-up numbers."
        action={
          <Link
            href="/workspace"
            data-dpf-primary-action
            data-owner-first-next-action
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            Open Operations
          </Link>
        }
      />
    </main>
  );
}
