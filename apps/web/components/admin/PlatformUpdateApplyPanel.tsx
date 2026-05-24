"use client";

// apps/web/components/admin/PlatformUpdateApplyPanel.tsx
//
// 2026-05-23 BI-9B77E247: The UpdatePendingBanner directs operators to
// /admin/platform-development to apply the queued platform update, but
// before this panel existed the destination route had no Apply control —
// the merge logic was only reachable from a coworker turn via the
// apply_platform_update MCP tool. When the System Admin coworker fell
// back to the local model (provider-routing degraded state, BI-FF180422)
// it could not reliably invoke that tool, leaving operators with no path
// to apply queued updates.
//
// This panel renders an Apply control directly on the destination route.
// It invokes the shared applyPlatformUpdate server action (single source
// of truth shared with the MCP tool case), and surfaces the structured
// result inline — clean merge summary on success, or a per-file conflict
// list with upstream-vs-local previews when human resolution is required.
//
// Conflict resolution is intentionally NOT automated here. Listing the
// conflicts gives an operator or admin agent a concrete source-workspace
// recovery path without depending on Build Studio availability.

import { useActionState } from "react";

import {
  applyPlatformUpdate,
  type ApplyPlatformUpdateResult,
} from "@/lib/actions/platform-dev-config";

type Props = {
  /** From PlatformDevConfig.updatePending — when false, this panel renders nothing. */
  updatePending: boolean;
  /** From PlatformDevConfig.pendingVersion — displayed prominently when present. */
  pendingVersion: string | null;
};

async function applyAction(
  _previous: ApplyPlatformUpdateResult | null,
): Promise<ApplyPlatformUpdateResult> {
  return applyPlatformUpdate();
}

export function PlatformUpdateApplyPanel({ updatePending, pendingVersion }: Props) {
  const [state, formAction, isPending] = useActionState<ApplyPlatformUpdateResult | null, FormData>(
    applyAction as unknown as (
      previous: ApplyPlatformUpdateResult | null,
      formData: FormData,
    ) => Promise<ApplyPlatformUpdateResult>,
    null,
  );

  // Steady-state: no pending update AND no in-flight action AND no prior result.
  // Don't render at all — the page header is enough signal that nothing is
  // pending. This keeps the destination route quiet on healthy installs.
  if (!updatePending && !state && !isPending) {
    return null;
  }

  // Prefer the live pendingVersion; fall back to the most recent successful
  // apply (state) for the brief moment between the apply completing and the
  // page revalidating with updatePending=false.
  const versionLabel =
    pendingVersion ??
    (state?.kind === "clean-merge" ? state.version : "") ??
    "";

  return (
    <section
      style={{
        border: "1px solid color-mix(in srgb, var(--dpf-accent) 30%, transparent)",
        borderRadius: 8,
        padding: 16,
        margin: "16px 0",
        background: "color-mix(in srgb, var(--dpf-accent) 6%, transparent)",
      }}
      aria-labelledby="platform-update-apply-heading"
    >
      <h2
        id="platform-update-apply-heading"
        style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--dpf-text)" }}
      >
        Platform update available
      </h2>

      {updatePending && (
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginTop: 6, marginBottom: 12 }}>
          Version <code style={{ overflowWrap: "anywhere" }}>{versionLabel}</code> is queued.
          Applying merges new platform source into your <code>my-changes</code> branch. Your
          customisations are preserved; conflicts (if any) are listed here for review and are
          not auto-resolved.
        </p>
      )}

      {updatePending && (
        <form action={formAction}>
          <button
            type="submit"
            disabled={isPending}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 4,
              border: "1px solid var(--dpf-accent)",
              background: isPending
                ? "color-mix(in srgb, var(--dpf-accent) 30%, transparent)"
                : "var(--dpf-accent)",
              color: "var(--dpf-bg)",
              cursor: isPending ? "wait" : "pointer",
            }}
          >
            {isPending ? "Applying…" : "Apply update"}
          </button>
        </form>
      )}

      {state && <ApplyResult result={state} />}
    </section>
  );
}

export function ApplyResult({ result }: { result: ApplyPlatformUpdateResult }) {
  switch (result.kind) {
    case "clean-merge":
      return (
        <div
          role="status"
          style={{
            marginTop: 14,
            padding: 10,
            border: "1px solid color-mix(in srgb, var(--dpf-success) 40%, transparent)",
            borderRadius: 4,
            background: "color-mix(in srgb, var(--dpf-success) 8%, transparent)",
            fontSize: 13,
          }}
        >
          <strong>Update applied.</strong> Platform is now on v{result.version}.{" "}
          {result.filesUpdated} file{result.filesUpdated === 1 ? "" : "s"} updated.
          No conflicts. Reload the page to see the new banner state.
        </div>
      );
    case "conflicts":
      return (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: 10,
            border: "1px solid color-mix(in srgb, var(--dpf-warning) 40%, transparent)",
            borderRadius: 4,
            background: "color-mix(in srgb, var(--dpf-warning) 8%, transparent)",
            fontSize: 13,
          }}
        >
          <strong>
            {result.resumedMerge ? "Merge already in progress." : "Merge has conflicts."}
          </strong>{" "}
          {result.conflicts.length} file{result.conflicts.length === 1 ? "" : "s"} need
          resolution. The merge is paused in the managed source workspace on the{" "}
          <code>my-changes</code> branch. Resolve the listed files there, run the verification
          gate, then finish the merge commit.
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            {result.conflicts.map((c) => (
              <li key={c.file} style={{ marginBottom: 8 }}>
                <code style={{ overflowWrap: "anywhere" }}>{c.file}</code>
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>Show diff preview</summary>
                  <pre
                    style={{
                      fontSize: 11,
                      background: "var(--dpf-bg)",
                      padding: 6,
                      overflowX: "auto",
                      borderRadius: 3,
                      marginTop: 4,
                    }}
                  >
                    {`<<<<<<< upstream\n${c.upstreamChange}\n=======\n${c.localChange}\n>>>>>>> local`}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </div>
      );
    case "no-update-pending":
    case "invalid-version":
    case "error":
      return (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: 10,
            border: "1px solid color-mix(in srgb, var(--dpf-error) 40%, transparent)",
            borderRadius: 4,
            background: "color-mix(in srgb, var(--dpf-error) 8%, transparent)",
            fontSize: 13,
          }}
        >
          <strong>Apply failed.</strong> {result.message}
        </div>
      );
  }
}
