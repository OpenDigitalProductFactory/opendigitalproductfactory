import { Skeleton } from "@/components/ui/report-kit";

export default function PerformanceLoading() {
  return (
    <main
      className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6"
      aria-label="Loading business performance"
    >
      <header className="space-y-3">
        <Skeleton width={180} height={24} />
        <Skeleton width="min(42rem, 100%)" lines={2} />
      </header>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading metrics">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={112} rounded="lg" />
        ))}
      </section>
    </main>
  );
}
