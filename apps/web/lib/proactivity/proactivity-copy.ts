import type { ProactivityLevel } from "./proactivity-types";

export const PROACTIVITY_LEVEL_COPY: Record<
  ProactivityLevel,
  {
    label: string;
    description: string;
    accent: "green" | "yellow" | "red";
    gaugeNeedle: "low" | "center" | "high";
    ariaLabel: string;
  }
> = {
  quiet: {
    label: "Quiet",
    description: "Wait for me unless something is urgent or already approved.",
    accent: "green",
    gaugeNeedle: "low",
    ariaLabel: "Proactivity quiet, minimum follow-up",
  },
  balanced: {
    label: "Balanced",
    description: "Follow up when timing, commitments, or risk make it useful.",
    accent: "yellow",
    gaugeNeedle: "center",
    ariaLabel: "Proactivity balanced, normal follow-up",
  },
  assertive: {
    label: "Assertive",
    description: "Stay on this, warn earlier, and escalate sooner when allowed.",
    accent: "red",
    gaugeNeedle: "high",
    ariaLabel: "Proactivity assertive, aggressive follow-up",
  },
};

export function getProactivityLevelCopy(level: ProactivityLevel) {
  return PROACTIVITY_LEVEL_COPY[level];
}
