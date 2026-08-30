import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { EmptyState } from "@/components/ui/report-kit";
import { BusinessPerformanceDashboard } from "@/components/performance/BusinessPerformanceDashboard";
import { loadBusinessPerformance } from "@/lib/performance/business-performance-provider";
import { listBusinessAnalysisWatchesFor } from "@/lib/performance/business-analysis-watch.server";

export const metadata: Metadata = {
  title: "Performance",
  description: "Business results, trends, and operating drivers for owners and managers.",
};

export const dynamic = "force-dynamic";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams?: Promise<{ period?: string }>;
} = {}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const query = await searchParams;
  const performance = await loadBusinessPerformance(
    { userId: session.user.id, ...(query?.period ? { period: query.period } : {}) },
  );
  const watches = performance.status === "ready"
    ? await listBusinessAnalysisWatchesFor(session.user.id, performance.organizationId)
    : [];

  return (
    <main
      className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6"
      data-component="business-performance-home"
      data-source={performance.source}
    >
      <header className="space-y-1" data-dpf-lead>
        <h1 className="text-xl font-semibold text-[var(--dpf-text)]">Performance</h1>
        <p className="max-w-3xl text-sm text-[var(--dpf-text-secondary)]">
          Review results, trends, and their operating evidence.
        </p>
      </header>

      {performance.status === "ready" ? (
        <BusinessPerformanceDashboard performance={performance} watches={watches} />
      ) : (
        <EmptyState
          title={
            performance.applicable
              ? "Performance history is not ready yet"
              : "Performance isn't available for this business type"
          }
          description={
            performance.applicable
              ? `${performance.reason} We will not show made-up numbers.`
              : performance.reason
          }
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
      )}
    </main>
  );
}
