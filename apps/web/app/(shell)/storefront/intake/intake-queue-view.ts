type QueueSummaryInput = {
  ready: boolean;
  completionPercent: number;
  openExceptions: Array<{ exceptionId: string }>;
};

export function summarizeIntakeQueue(items: QueueSummaryInput[]) {
  return items.reduce(
    (summary, item) => {
      summary.total += 1;
      if (item.ready) summary.ready += 1;
      else if (item.openExceptions.length > 0) summary.needsAttention += 1;
      else summary.inProgress += 1;
      return summary;
    },
    { total: 0, ready: 0, needsAttention: 0, inProgress: 0 },
  );
}

const BLOCKER_LABELS: Record<string, string> = {
  "required-answers-missing": "Required information missing",
  "consent-incomplete": "Consent incomplete",
  "coverage-unverified": "Coverage not verified",
  "exceptions-unresolved": "Exception needs review",
};

export function formatIntakeBlocker(blocker: string): string {
  return BLOCKER_LABELS[blocker] ?? "Additional review needed";
}

export function formatSourceMode(mode: string): string {
  return mode
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatAppointmentTime(value: Date): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value)} UTC`;
}
