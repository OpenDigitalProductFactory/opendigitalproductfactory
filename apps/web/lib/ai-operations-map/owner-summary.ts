import type { OperationsMapActivityRouting } from "./types";

type OwnerSummaryIntent = "attention" | "healthy" | "waiting";

export type OperationsMapOwnerSummary = {
  intent: OwnerSummaryIntent;
  eyebrow: string;
  title: string;
  description: string;
  facts: Array<{ label: string; value: string }>;
  primaryAction: { href: string; label: string };
  wordCount: number;
};

function countWords(parts: string[]): number {
  return parts
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function withWordCount(
  summary: Omit<OperationsMapOwnerSummary, "wordCount">,
): OperationsMapOwnerSummary {
  return {
    ...summary,
    wordCount: countWords([
      summary.eyebrow,
      summary.title,
      summary.description,
      ...summary.facts.flatMap((fact) => [fact.label, fact.value]),
      summary.primaryAction.label,
    ]),
  };
}

export function buildOperationsMapOwnerSummary(
  routing: OperationsMapActivityRouting | null,
): OperationsMapOwnerSummary {
  if (!routing || routing.activities.length === 0) {
    return withWordCount({
      intent: "waiting",
      eyebrow: "AI routing",
      title: "No routing decisions recorded yet",
      description: "The map is ready. Activity decisions and outcome evidence will appear after routed AI work runs.",
      facts: [],
      primaryAction: { href: "#technical-routing-map", label: "Inspect routing map" },
    });
  }

  const affected = routing.activities.filter(
    (activity) => activity.successSignal === "failed" || activity.successSignal === "attention",
  );
  if (affected.length === 0) {
    return withWordCount({
      intent: "healthy",
      eyebrow: "AI routing",
      title: "Routing has no recorded failures",
      description: `${routing.activities.length} activity steps are available for inspection. Review a decision when you need its model choice, evidence, or exclusions.`,
      facts: [],
      primaryAction: {
        href: "#activity-routing-workbench",
        label: "Inspect routing decisions",
      },
    });
  }

  const first = affected[0];
  const firstExclusion = first.exclusions[0];
  const firstCandidate = first.enableCandidates?.[0];
  const sensitivity = firstCandidate?.satisfies.find((requirement) =>
    requirement.toLowerCase().includes("sensitivity"),
  );
  const facts: OperationsMapOwnerSummary["facts"] = [
    { label: "First affected", value: first.label },
    {
      label: "Why",
      value: firstExclusion?.reason || first.decisionSummary || "The route needs review.",
    },
  ];
  if (sensitivity) {
    facts.push({
      label: "Data class",
      value: sensitivity.charAt(0).toUpperCase() + sensitivity.slice(1),
    });
  }
  if (firstCandidate) {
    facts.push({
      label: "Provider path",
      value: `${firstCandidate.displayName} is disabled — ${firstCandidate.actionLabel}`,
    });
  } else if (firstExclusion?.remediation) {
    facts.push({ label: "Recovery", value: firstExclusion.remediation });
  }

  return withWordCount({
    intent: "attention",
    eyebrow: "AI routing needs you",
    title: `${affected.length} routing ${affected.length === 1 ? "step needs" : "steps need"} attention`,
    description: "Start with the first affected activity. Its decision, evidence, and supported recovery action are grouped below.",
    facts,
    primaryAction: {
      href: "#activity-routing-workbench",
      label: `Review ${first.label}`,
    },
  });
}
