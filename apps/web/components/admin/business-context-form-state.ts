import { industryLabel } from "@/lib/storefront/industries";

export type ArchetypeSummary = { name: string; category: string } | null;

export type ArchetypeSummaryState =
  | { kind: "picked"; name: string; industryLabel: string }
  | { kind: "empty"; setupHref: string };

export function resolveArchetypeSummaryState(summary: ArchetypeSummary): ArchetypeSummaryState {
  if (!summary) return { kind: "empty", setupHref: "/storefront/setup" };
  return { kind: "picked", name: summary.name, industryLabel: industryLabel(summary.category) };
}
