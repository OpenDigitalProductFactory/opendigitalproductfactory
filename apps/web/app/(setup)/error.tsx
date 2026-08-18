"use client";

// Route-group error boundary (BI-DD5FC4FF, Simplify & Strengthen W7).
// Thin wrapper — the shared face lives in ui/ErrorBoundaryCard.

import { ErrorBoundaryCard } from "@/components/ui/ErrorBoundaryCard";

export default function SetupError({
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
      title="Setup hit a problem"
      description="Something went wrong loading this setup step. Try again — your progress so far is saved."
    />
  );
}
