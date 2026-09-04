export type SourceState<T> =
  | { state: "available"; asOf: string; data: T; reason: null }
  | { state: "empty"; asOf: string; data: T; reason: null }
  | { state: "unavailable"; asOf: string; data: null; reason: string };

export function sourceAvailable<T>(data: T, asOf = new Date().toISOString()): SourceState<T> {
  return { state: "available", asOf, data, reason: null };
}

export function sourceEmpty<T>(data: T, asOf = new Date().toISOString()): SourceState<T> {
  return { state: "empty", asOf, data, reason: null };
}

export function sourceUnavailable<T = never>(reason: string, asOf = new Date().toISOString()): SourceState<T> {
  return { state: "unavailable", asOf, data: null, reason };
}

export type RescueSources = {
  animals: SourceState<{ inCare: number; intakeReview: number; legalHold: number; placementReady: number }>;
  capacity: SourceState<{ free: number; blocked: number }>;
  care: SourceState<{ dueToday: number; missed: number; exceptions: number }>;
  adoptions: SourceState<{ activeApplications: number; readyWithoutInterest: number }>;
  stewardship: SourceState<{ restrictedFunds: number; postedAnimalCost: number }>;
};

export function buildRescueCockpit(sources: RescueSources) {
  const attention: Array<{ label: string; count: number; href: string; intent: "critical" | "warning" | "info" }> = [];
  if (sources.care.state !== "unavailable" && sources.care.data.missed > 0) {
    attention.push({ label: "Missed care", count: sources.care.data.missed, href: "/workspace/rescue/care?filter=missed", intent: "critical" });
  }
  if (sources.animals.state !== "unavailable" && sources.animals.data.legalHold > 0) {
    attention.push({ label: "Legal holds", count: sources.animals.data.legalHold, href: "/workspace/rescue/intake?filter=legal-hold", intent: "warning" });
  }
  if (sources.adoptions.state !== "unavailable" && sources.adoptions.data.readyWithoutInterest > 0) {
    attention.push({ label: "Ready without interest", count: sources.adoptions.data.readyWithoutInterest, href: "/workspace/rescue/adoptions?filter=no-interest", intent: "info" });
  }
  return { sources, attention };
}
