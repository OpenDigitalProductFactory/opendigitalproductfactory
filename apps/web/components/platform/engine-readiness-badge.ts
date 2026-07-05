// apps/web/components/platform/engine-readiness-badge.ts
//
// Pure state→badge-content mapping for the Build Studio engine readiness badge
// (Build-Engine Provisioning, EP-2D477458, Phase 1b). Kept out of the
// "use client" form component so it is unit-testable without a React renderer.

export type EngineReadinessTone = "success" | "warning" | "muted";

/**
 * Map a probed engine's `present` state (+ optional version) to the badge's
 * icon, text, and tone. `present === null` means "never probed"; pass
 * `opts.probing` while a live probe is in flight so the badge reads
 * "Probing sandbox…" instead of a stale/never-probed state.
 *
 * State is conveyed by text + icon, never by color alone (accessibility).
 */
export function engineReadinessBadgeContent(
  present: boolean | null,
  version: string | null,
  opts: { probing?: boolean } = {},
): { icon: string; text: string; tone: EngineReadinessTone } {
  if (opts.probing) {
    return { icon: "⟳", text: "Probing sandbox…", tone: "muted" };
  }
  if (present === true) {
    return {
      icon: "✓",
      text: version ? `Installed in sandbox · v${version}` : "Installed in sandbox",
      tone: "success",
    };
  }
  if (present === false) {
    return { icon: "✗", text: "Not installed in sandbox", tone: "warning" };
  }
  return { icon: "•", text: "Sandbox readiness not yet probed", tone: "muted" };
}

export const ENGINE_READINESS_TONE_COLOR: Record<EngineReadinessTone, string> = {
  success: "var(--dpf-success)",
  warning: "var(--dpf-warning)",
  muted: "var(--dpf-muted)",
};
