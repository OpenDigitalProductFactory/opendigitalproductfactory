"use client";

// apps/web/components/ui/ErrorBoundaryCard.tsx
//
// Canonical body for a route-group error.tsx boundary (BI-DD5FC4FF, Simplify &
// Strengthen W7 — architecture pass 2026-08-16 §3.3-e: the app had 2 error.tsx
// for 350 routes). Each route group's error.tsx stays a thin wrapper around
// this card so every surface fails with the same face: token-styled, a plain
// explanation, and a Try-again that calls the boundary's reset().
//
// The (shell) group keeps its richer boundary (auto-reporting + deployment-skew
// recovery in app/(shell)/error.tsx); this card is the default for everything
// else. Composes ui/Surface + ui/Button (W5).

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";

export type ErrorBoundaryCardProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Route-group-specific heading, e.g. "Sign-in hit a problem". */
  title: string;
  /** One-sentence plain-language description of what to do. */
  description: string;
};

export function ErrorBoundaryCard({ error, reset, title, description }: ErrorBoundaryCardProps) {
  useEffect(() => {
    // The digest is the only durable handle in production — log it so an
    // operator (or an AI client reading the console) can find the server error.
    console.error("Route boundary error:", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <Surface padding="lg" className="w-full max-w-[34rem] text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-2xl font-semibold text-[var(--dpf-accent)]"
        >
          !
        </div>
        <h2 className="mb-2 text-lg font-semibold text-[var(--dpf-text)]">{title}</h2>
        <p className="mb-5 text-sm leading-6 text-[var(--dpf-muted)]">{description}</p>
        {error.digest && (
          <p className="mb-5 font-mono text-xs text-[var(--dpf-muted)]">Reference: {error.digest}</p>
        )}
        <Button onClick={reset}>Try again</Button>
      </Surface>
    </div>
  );
}
