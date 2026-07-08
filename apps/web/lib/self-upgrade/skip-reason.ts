/**
 * Human-readable explanations for a self-upgrade run's `skipped` status.
 *
 * `runSelfUpgrade` (apps/web/lib/queue/functions/self-upgrade.ts) records a
 * machine reason string on the run's `reason` column whenever it short-circuits
 * to `skipped` — e.g. `activity-in-flight: build-studio.phase.build` or
 * `cooldown: 2026-06-15T00:13:22.503Z`. That string is persisted for audit but
 * is not operator-facing on its own: "skipped" with no words is the silent
 * no-op the Self-Upgrade panel must never show (an operator should never be left
 * guessing whether a skip was correct or a bug).
 *
 * This maps the persisted reason to a title + plain-English detail + an
 * optional remedy, so the panel can explain WHY the upgrade didn't run and what
 * the operator can do about it. Keep the keys in sync with the `skipAttempt`
 * reasons in self-upgrade.ts.
 */

export type SkipReasonExplanation = {
  /** Short label, e.g. "Build in progress". */
  title: string;
  /** One-sentence plain-English explanation of why the upgrade was skipped. */
  detail: string;
  /** Optional next action the operator can take. */
  remedy?: string;
};

/**
 * Friendly label for a quiescence blocker surface key. Mirrors `surfaceLabel`
 * in SelfUpgradeClient.tsx so the activity-in-flight detail reads the same
 * whether it comes from a live blocker line or a persisted skip reason.
 */
function surfaceLabel(surface: string): string {
  if (surface === "coworker.reasoning-loop") return "an AI coworker working";
  if (surface === "request.recent-tool-execution") return "recent portal / MCP activity";
  if (surface === "build-studio.phase.ship") return "a Build Studio ship phase";
  if (surface.startsWith("build-studio.phase.")) {
    return `a Build Studio ${surface.slice("build-studio.phase.".length)} phase`;
  }
  return surface;
}

/** Deduplicate + humanise the comma-separated surfaces in an activity reason. */
function describeActiveSurfaces(rest: string): string {
  const surfaces = Array.from(
    new Set(
      rest
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ).map(surfaceLabel);
  if (surfaces.length === 0) return "in-flight work";
  if (surfaces.length === 1) return surfaces[0];
  if (surfaces.length === 2) return `${surfaces[0]} and ${surfaces[1]}`;
  return `${surfaces.slice(0, -1).join(", ")}, and ${surfaces[surfaces.length - 1]}`;
}

const EMERGENCY_OVERRIDE_REMEDY =
  'Wait for the work to finish and try again, or tick "Emergency override" to force the upgrade now (this can interrupt in-flight work).';

/**
 * Turn a persisted self-upgrade skip `reason` into an operator-facing
 * explanation. The reason is of the form `key` or `key: extra`; we branch on the
 * key prefix and fold any extra detail into the message.
 */
export function describeSkipReason(
  reason: string | null | undefined,
): SkipReasonExplanation | null {
  if (!reason) return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;

  const sepIndex = trimmed.indexOf(":");
  const key = (sepIndex === -1 ? trimmed : trimmed.slice(0, sepIndex)).trim();
  const rest = sepIndex === -1 ? "" : trimmed.slice(sepIndex + 1).trim();

  switch (key) {
    case "activity-in-flight":
      return {
        title: "Work in progress",
        detail: `The upgrade didn't run because ${describeActiveSurfaces(
          rest,
        )} was in flight. The portal was left running rather than drained mid-task.`,
        remedy: EMERGENCY_OVERRIDE_REMEDY,
      };
    case "cooldown":
      return {
        title: "Cooling down",
        detail:
          "A recent attempt deferred or failed, so automatic upgrades are paused briefly to avoid re-draining the portal in a loop.",
        remedy:
          'Wait for the cooldown to clear, or tick "Emergency override" to run now.',
      };
    case "outside-window":
      return {
        title: "Outside the upgrade window",
        detail:
          "Scheduled upgrades only run while the storefront is closed (the maintenance window). The store is currently open.",
        remedy:
          'Use "Upgrade now" to run immediately — a manual upgrade is not window-gated.',
      };
    case "interval-not-elapsed":
      return {
        title: "Checked recently",
        detail:
          "The scheduled poll already checked for a new build within the configured interval, so this tick was skipped.",
        remedy: 'Use "Upgrade now" to check immediately.',
      };
    case "promoter-unavailable":
      return {
        title: "Upgrade engine not ready",
        detail: `The promoter image${
          rest ? ` (${rest})` : ""
        } isn't built on this host and couldn't be built automatically, so the portal can't be swapped. The portal was left running rather than drained.`,
        remedy:
          'Use "Build engine now" below to build it (or ask the AI Ops Engineer to). The next attempt resumes automatically once it succeeds. A custom/registry promoter image must be provided by the operator.',
      };
    case "batch-below-threshold":
      return {
        title: "Batching updates",
        detail: `Routine upgrades deploy merged updates in batches so the portal isn't paused for every single change${
          rest ? ` — ${rest.replace(" PRs pending", "").replace("/", " of ")} accumulated so far` : ""
        }. The upgrade runs automatically once the batch is ready or the oldest update has waited long enough.`,
        remedy: 'Use "Upgrade now" to deploy the pending updates immediately.',
      };
    case "up-to-date":
      return {
        title: "Already up to date",
        detail: `The running build already contains the target${
          rest ? ` (${rest})` : ""
        }, so there was nothing newer to deploy.`,
      };
    case "no-target":
      return {
        title: "No upgrade target",
        detail:
          "No target build could be resolved from the upstream source, so there was nothing to deploy.",
      };
    case "active-run":
      return {
        title: "Another run is active",
        detail: `Another self-upgrade run${
          rest ? ` (${rest})` : ""
        } is already in flight, so this trigger was skipped to avoid a double swap.`,
        remedy: "Wait for the active run to finish, then retry.",
      };
    case "disabled":
      return {
        title: "Self-upgrade disabled",
        detail:
          "Self-upgrade is turned off, so the trigger was skipped without checking for a new build.",
        remedy: "Enable self-upgrade in settings to allow upgrades.",
      };
    default:
      // Unknown reason: still surface the raw string rather than a blank skip,
      // so the operator is never left guessing.
      return {
        title: "Upgrade skipped",
        detail: trimmed,
      };
  }
}
