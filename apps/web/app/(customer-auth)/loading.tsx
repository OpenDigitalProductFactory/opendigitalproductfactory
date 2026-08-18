import { Skeleton } from "@/components/ui/report-kit";

// Route-group loading boundary (BI-DD5FC4FF, Simplify & Strengthen W7).
// Skeleton is the canonical shimmer (check-no-hand-rolled-loading guard).

export default function CustomerAuthLoading() {
  return (
    <div aria-label="Loading sign-in" className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-[34rem] space-y-3">
        <Skeleton width={200} height={24} />
        <Skeleton lines={3} />
        <Skeleton height={40} rounded="lg" />
      </div>
    </div>
  );
}
