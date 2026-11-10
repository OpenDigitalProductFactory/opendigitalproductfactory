import { portfolioLabel, portfolioOf } from "./outside-in";
import { residueReasonLabel } from "./triage";
import type { OwnerDecisionChoice, OwnerTechnicalField } from "./owner-decision";
import { specialistFor } from "./owner-decision-copy";
import type { AttentionItem } from "./types";

export function technicalFields(item: AttentionItem): OwnerTechnicalField[] {
  const backlogItemId =
    item.technical?.backlogItemId ??
    (item.triage.blastRadius?.match(/\bBI-[A-Z0-9-]+\b/i)?.[0] ?? "Not attached");
  const featureBuildId = item.technical?.featureBuildId ?? readFeatureBuildId(item) ?? "Not attached";
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
    ...envelopeTechnicalFields(item),
  ];
}

function envelopeTechnicalFields(item: AttentionItem): OwnerTechnicalField[] {
  const envelope = item.envelope;
  if (!envelope) return [];
  const fields: OwnerTechnicalField[] = [
    { label: "Coworker", value: envelope.coworkerAgentId },
    { label: "Requested action", value: envelope.manifestActionId },
    { label: "Status", value: envelope.status },
    { label: "Open until", value: envelope.expiresAtIso ?? "No time limit" },
  ];
  if (envelope.taskRunId) fields.push({ label: "Task", value: envelope.taskRunId });
  const binding = envelope.reviewBinding;
  if (binding) {
    fields.push(
      { label: "Repository", value: binding.repositoryFullName },
      { label: "Commit", value: binding.commitSha },
      { label: "File", value: binding.path },
      { label: "Blob", value: binding.providerBlobId },
    );
  }
  return fields;
}

export function builderActions(item: AttentionItem): OwnerDecisionChoice[] {
  const backlogItemId =
    item.technical?.backlogItemId ?? item.triage.blastRadius?.match(/\bBI-[A-Z0-9-]+\b/i)?.[0];
  const featureBuildId = item.technical?.featureBuildId ?? readFeatureBuildId(item);
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

const FEATURE_BUILD_PATTERN = /\bFB-[A-Z0-9-]+\b/i;

/**
 * The feature build this item is about, from the deep link's `buildId` query
 * param OR from the blast radius prose.
 *
 * The blast-radius fallback matters (BI-90B6D8C5): an `ai-decision` item's deep
 * link is `/platform/ai/decisions/DI-…` with no query string, so query-only
 * parsing reported "Not attached" for cards whose own consequence line reads
 * "build FB-1DB2A3B5 stays blocked" — and suppressed the `Resume build` action
 * that is the one route to the surface where the gate can actually be answered.
 */
function readFeatureBuildId(item: AttentionItem): string | null {
  return (
    readQueryId(item.deepLink, "buildId", FEATURE_BUILD_PATTERN)
    ?? item.triage.blastRadius?.match(FEATURE_BUILD_PATTERN)?.[0]
    ?? null
  );
}

function readQueryId(href: string, key: string, pattern: RegExp): string | null {
  try {
    const value = new URL(href, "http://dpf.local").searchParams.get(key);
    return value?.match(pattern)?.[0] ?? null;
  } catch {
    return null;
  }
}
