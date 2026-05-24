// apps/web/components/build/OpenSandboxButton.tsx
//
// Single shared "Open live preview" button. Lives in the BuildStudio footer;
// the per-build Preview tab is removed in this redesign because the sandbox
// (the underlying compose service) is shared across all in-flight builds
// (project_self_upgrade_kills_in_session_ux). The component file name
// (OpenSandboxButton) is kept for symbol stability per the 2026-05-24 portal
// topology consolidation spec §8.3.
//
// Per the design spec §1 (Footer) and §6 (component contract):
//   - Renders <a target="_blank" rel="noopener noreferrer"> — rel is non-optional.
//   - Label: "Open live preview · driving: {code | 'idle'}". The component
//     name (OpenSandboxButton) and the underlying URL still point at the
//     "sandbox" compose service — only the user-facing string flipped
//     per the 2026-05-24 portal topology consolidation spec §8.1.
//   - Disabled visual + aria-disabled when sandboxUrl is empty.
//   - Deterministic driver via sandbox-driver helper (R1 from peer review).
//
// This component is intentionally dumb: it consumes a pre-computed driver
// code + URL. The shell that mounts it (T8c) is responsible for calling
// computeDrivingBuild() and passing the resulting code in.

"use client";

import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";
import { formatSandboxLabel } from "@/lib/build/sandbox-driver";

export type OpenSandboxButtonProps = {
  /** Semantic FB-* code of the build that owns the sandbox right now, or null
   *  when nothing is running. */
  drivingBuildCode: string | null;
  /** Sandbox preview URL. Empty/null disables the button. */
  sandboxUrl: string;
};

export function OpenSandboxButton({ drivingBuildCode, sandboxUrl }: OpenSandboxButtonProps) {
  const label = formatSandboxLabel(drivingBuildCode);
  const isDisabled = !sandboxUrl || sandboxUrl.trim().length === 0;

  if (isDisabled) {
    // Render a non-link span so we don't emit a dangling anchor with no href.
    // aria-disabled communicates the disabled state to screen readers.
    return (
      <span
        role="link"
        aria-disabled="true"
        data-testid={BUILD_STUDIO_TEST_IDS.openSandbox}
        data-driving={drivingBuildCode ?? "idle"}
        className="inline-flex cursor-not-allowed select-none items-center gap-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-muted)] opacity-60"
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={sandboxUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={BUILD_STUDIO_TEST_IDS.openSandbox}
      data-driving={drivingBuildCode ?? "idle"}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
    >
      {label}
    </a>
  );
}
