"use client";

// Route-group error boundary (BI-DD5FC4FF, Simplify & Strengthen W7).
// Thin wrapper — the shared face lives in ui/ErrorBoundaryCard.

import { ErrorBoundaryCard } from "@/components/ui/ErrorBoundaryCard";

export default function PortalError({
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
      title="The portal hit a problem"
      description="Something went wrong loading this portal page. Trying again usually fixes it."
    />
  );
}
