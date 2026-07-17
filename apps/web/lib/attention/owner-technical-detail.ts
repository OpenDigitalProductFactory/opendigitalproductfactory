import { portfolioLabel, portfolioOf } from "./outside-in";
import { residueReasonLabel } from "./triage";
import type { OwnerDecisionChoice, OwnerTechnicalField } from "./owner-decision";
import { specialistFor } from "./owner-decision-copy";
import type { AttentionItem } from "./types";

export function technicalFields(item: AttentionItem): OwnerTechnicalField[] {
  const backlogItemId =
    item.technical?.backlogItemId ??
    (item.triage.blastRadius?.match(/\bBI-[A-Z0-9-]+\b/i)?.[0] ?? "Not attached");
  const featureBuildId =
    item.technical?.featureBuildId ??
    readQueryId(item.deepLink, "buildId", /\bFB-[A-Z0-9-]+\b/i) ??
    "Not attached";
  return [
    { label: "Original title", value: item.title },
    { label: "Source", value: item.source },
    { label: "Work type", value: item.technical?.workType ?? "Not linked to backlog" },
    { label: "Effort", value: item.technical?.effort ?? "Not linked to backlog" },
    { label: "Epic", value: item.technical?.epic ?? "Not attached" },
    {
      label: "Ownership domain",
      value: item.technical?.ownershipDomain ?? portfolioLabel(portfolioOf(item)),
    },
    { label: "Backlog item", value: backlogItemId },
    { label: "Feature build", value: featureBuildId },
    { label: "Detected", value: item.createdAtIso },
    { label: "Detected by", value: item.technical?.detectedBy ?? specialistFor(item.source) },
    { label: "Risk", value: item.riskClass },
    { label: "Why it was routed", value: residueReasonLabel(item.triage.residueReason) },
    { label: "Original context", value: item.context || "No extra context recorded" },
  ];
}

export function builderActions(item: AttentionItem): OwnerDecisionChoice[] {
  const backlogItemId =
    item.technical?.backlogItemId ?? item.triage.blastRadius?.match(/\bBI-[A-Z0-9-]+\b/i)?.[0];
  const featureBuildId =
    item.technical?.featureBuildId ??
    readQueryId(item.deepLink, "buildId", /\bFB-[A-Z0-9-]+\b/i);
  const actions: OwnerDecisionChoice[] = [
    { kind: "open-in-context", label: "Open in Operations", href: "/ops" },
  ];
  if (featureBuildId) {
    actions.push({
      kind: "open-in-context",
      label: "Resume build",
      href: `/build?buildId=${encodeURIComponent(featureBuildId)}`,
    });
  }
  if (backlogItemId) {
    actions.push({
      kind: "open-in-context",
      label: "Edit fields",
      href: `/ops?itemId=${encodeURIComponent(backlogItemId)}`,
    });
  }
  for (const action of item.actions) {
    if (!action.href || actions.some((existing) => existing.href === action.href)) continue;
    actions.push({ ...action, href: action.href });
  }
  return actions;
}

function readQueryId(href: string, key: string, pattern: RegExp): string | null {
  try {
    const value = new URL(href, "http://dpf.local").searchParams.get(key);
    return value?.match(pattern)?.[0] ?? null;
  } catch {
    return null;
  }
}
