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

export type RescueFilterArea = "overview" | "animals" | "intake" | "care" | "adoptions" | "stewardship";
export type RescueFilter = "all" | "missed" | "legal-hold" | "no-interest";

export type RescueQueueRow = {
  id: string;
  reference: string;
  primary: string;
  detail: string | null;
  status: string;
  occurredAt: string | null;
};

export type RescueQueueData = {
  title: string;
  description: string;
  rows: RescueQueueRow[];
  limit: number;
  action: { label: string; href: string } | null;
};

const AREA_FILTERS: Record<RescueFilterArea, readonly RescueFilter[]> = {
  overview: ["all"],
  animals: ["all"],
  intake: ["all", "legal-hold"],
  care: ["all", "missed"],
  adoptions: ["all", "no-interest"],
  stewardship: ["all"],
};

export function parseRescueFilter(area: RescueFilterArea, value: string | string[] | undefined): RescueFilter {
  if (typeof value !== "string") return "all";
  return AREA_FILTERS[area].includes(value as RescueFilter) ? value as RescueFilter : "all";
}

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
