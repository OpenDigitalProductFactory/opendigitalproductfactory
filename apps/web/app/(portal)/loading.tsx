import { Skeleton } from "@/components/ui/report-kit";

// Route-group loading boundary (BI-DD5FC4FF, Simplify & Strengthen W7).
// Skeleton is the canonical shimmer (check-no-hand-rolled-loading guard).

export default function PortalLoading() {
  return (
    <main aria-label="Loading portal" className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="space-y-3">
        <Skeleton width={220} height={24} />
        <Skeleton width="min(42rem, 100%)" lines={2} />
      </header>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading content">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} height={112} rounded="lg" />
        ))}
      </section>
    </main>
  );
}
