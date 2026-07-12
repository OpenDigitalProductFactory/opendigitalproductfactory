// BI-AB7CD55B (EP-B9DD37C7 truthfulness): the honest "what this dial actually
// changes" projection for the proactivity level. Every line here corresponds to
// a REAL runtime consumer of the level; nothing is listed that no code enforces.
// The resolver also computes monitoring/approval/escalation fields, but those
// are display-only today — rendering them as effects was the mislabel this
// module replaces (enforcement is tracked separately on the epic).
import type { ProactivityLevel } from "./proactivity-types";

export type CoworkerSelfTaskCadenceInfo = {
  /** True when the coworker is registered in COWORKER_SELF_TASKS. */
  registered: boolean;
  /** Friendly cadence per level when registered, e.g. "weekly", "daily",
   *  "twice weekly" (quiet is always "off"). */
  cadence: { balanced: string; assertive: string } | null;
};

export type ProactivityEffectLine = { label: string; value: string };

/** One line per real consumer of the level, in user language. */
export function describeProactivityEffects(
  level: ProactivityLevel,
  selfTask: CoworkerSelfTaskCadenceInfo,
): ProactivityEffectLine[] {
  const lines: ProactivityEffectLine[] = [];

  // Consumer: buildInitiativeBlock → the coworker's in-chat effort posture.
  lines.push({
    label: "In chat",
    value:
      level === "quiet"
        ? "Answers what you ask, no extra follow-up"
        : level === "assertive"
          ? "Volunteers next steps and follow-ups"
          : "Follows up when it's useful",
  });

  // Consumer: opening-briefing loader/composer — presence of the greeting brief.
  lines.push({
    label: "Opening briefing",
    value:
      level === "quiet"
        ? "Silent on open"
        : level === "assertive"
          ? "Always briefs, even the all-clear"
          : "Speaks only when something needs you",
  });

  // Consumer: reconcileCoworkerSelfTask — real cron-backed scheduled work, but
  // only for coworkers registered in COWORKER_SELF_TASKS. Say so honestly.
  if (selfTask.registered && selfTask.cadence) {
    lines.push({
      label: "Scheduled self-tasks",
      value: level === "quiet" ? "Off" : capitalize(selfTask.cadence[level]),
    });
  } else {
    lines.push({
      label: "Scheduled self-tasks",
      value: "Not available for this coworker yet",
    });
  }

  // Consumers: the scheduler's retry policy (followUpCadenceMinutes/maxAttempts,
  // enforced per BI-754C9E82) + the attention source's urgency and routing.
  // Copy is kept aligned with DEFAULTS_BY_LEVEL in proactivity-resolver.ts by a
  // drift test in proactivity-effects.test.ts.
  lines.push({
    label: "If its task fails",
    value:
      level === "quiet"
        ? "No retries; stays out of your attention list"
        : level === "assertive"
          ? "Retries after 30 and 60 minutes, then flags you urgently"
          : "Retries once after 2 hours, then shows in your attention list",
  });

  return lines;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
