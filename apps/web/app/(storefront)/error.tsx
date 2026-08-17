"use client";

// Route-group error boundary (BI-DD5FC4FF, Simplify & Strengthen W7).
// Thin wrapper — the shared face lives in ui/ErrorBoundaryCard.

import { ErrorBoundaryCard } from "@/components/ui/ErrorBoundaryCard";

export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorBoundaryCard
      error={error}
      reset={reset}
      title="This page hit a problem"
      description="Something went wrong loading this page. Trying again usually fixes it."
    />
  );
}
