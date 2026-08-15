// apps/web/lib/self-upgrade/impact/phrase.ts
//
// LLM phrasing pass for the upgrade impact summary. The deterministic
// pipeline (classify → score → order) is the contract; the LLM ONLY phrases.
//
// Hard constraints:
//   1. The number and order of phrased items MUST match the input items.
//   2. The LLM cannot add, drop, or reorder items.
//   3. SHAs and file paths must NOT appear in the default operator view.
//   4. If the LLM returns malformed JSON, length-mismatched output, or fails
//      entirely, this module returns `null` and the orchestrator surfaces the
//      raw deterministic shape — no fabricated phrasing.

import { callLLM } from "@/lib/llm-call";
import type {
  ImpactCategoryCounts,
  ImpactItem,
  InstallSignals,
  PhrasedImpactSummary,
} from "./types";

const SYSTEM_PROMPT = `You phrase a software upgrade impact summary for a non-technical operator.

You will receive:
- "install": short facts about the operator's portal (archetype, industry, customization themes).
- "counts": totals per category that drive the headline.
- "items": an ordered list of pre-scored changes. EACH ITEM has a stable index.

Your job is ONLY phrasing. Follow these rules:

1. Output strict JSON matching the schema below. No prose outside JSON.
2. Produce EXACTLY one phrasing for each item, in the SAME order. Length must equal items.length.
3. Do NOT add, drop, reorder, recategorize, or invent items.
4. Do NOT include SHAs, file paths, commit hashes, or PR numbers in any field.
5. Each item's "description" is ONE plain-English sentence (<=20 words) that says what changed.
6. Each item's "whyRelevant" is ONE plain-English sentence (<=20 words) tied to install state — empty string when no install-specific reason exists.
7. "headline" is ONE sentence summarising counts in plain English (e.g. "1 breaking change, 2 new features, and 5 fixes since your last upgrade."). Name each category the counts actually contain — say "dependency updates", "documentation", "internal maintenance" and "security fixes" rather than collapsing them into "other changes".
8. "touchesCustomizationsCallout" is ONE sentence ONLY if any item has touchesCustomizations=true; otherwise empty string. Mention this may need merge review.
9. If an item description is empty or just a type prefix, paraphrase it neutrally as "internal change" — do not invent details.
10. Each item's phrasing must be true to its category: "dependency" says which dependency moved, "documentation" says what was documented, "maintenance" says what internal upkeep happened, "security" says what was patched or hardened. Never describe a dependency bump as a new feature.

Schema:
{
  "headline": string,
  "itemPhrasings": [{ "description": string, "whyRelevant": string }, ...],
  "touchesCustomizationsCallout": string
}`;

type LlmPayload = {
  install: {
    archetypeId: string | null;
    industry: string | null;
    customizationVerticals: string[];
    openIssueKeywords: string[];
  };
  counts: ImpactCategoryCounts;
  items: Array<{
    index: number;
    category: ImpactItem["category"];
    type: ImpactItem["type"];
    scope: string | null;
    breaking: boolean;
    description: string;
    prTitle: string | null;
    prLabels: string[];
    touchesCustomizations: boolean;
    reasonTags: string[];
  }>;
};

function buildPayload(
  items: ImpactItem[],
  counts: ImpactCategoryCounts,
  signals: InstallSignals,
): LlmPayload {
  return {
    install: {
      archetypeId: signals.archetypeId,
      industry: signals.industry,
      customizationVerticals: signals.customizationVerticals,
      openIssueKeywords: signals.openIssueKeywords.slice(0, 12),
    },
    counts,
    items: items.map((item, index) => ({
      index,
      category: item.category,
      type: item.type,
      scope: item.scope,
      breaking: item.breaking,
      description: item.description,
      prTitle: item.prTitle,
      prLabels: item.prLabels,
      touchesCustomizations: item.touchesCustomizations,
      reasonTags: item.reasons.map((r) => r.kind),
    })),
  };
}

/**
 * Extract a parseable JSON object from raw LLM text. Models occasionally wrap
 * JSON in ```json fences or prefix it with a one-line acknowledgement; we
 * tolerate both rather than reject the whole call.
 */
function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  // Strip ``` fences (with or without language tag).
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i);
  const candidate = fenced && fenced[1] ? fenced[1].trim() : trimmed;
  // Find the first `{` and the last `}`.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

type ValidatedPhrasing = PhrasedImpactSummary;

function validate(parsed: unknown, expectedLength: number): ValidatedPhrasing | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const headline = typeof obj["headline"] === "string" ? obj["headline"].trim() : "";
  const callout =
    typeof obj["touchesCustomizationsCallout"] === "string"
      ? obj["touchesCustomizationsCallout"].trim()
      : "";
  const rawItems = obj["itemPhrasings"];
  if (!Array.isArray(rawItems) || rawItems.length !== expectedLength) return null;

  const itemPhrasings: PhrasedImpactSummary["itemPhrasings"] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    const desc = typeof e["description"] === "string" ? e["description"].trim() : "";
    const why = typeof e["whyRelevant"] === "string" ? e["whyRelevant"].trim() : "";
    if (!desc) return null;
    itemPhrasings.push({ description: desc, whyRelevant: why });
  }

  if (!headline) return null;
  return { headline, itemPhrasings, touchesCustomizationsCallout: callout };
}

export type PhraseDeps = {
  /** Override for tests. */
  llm?: (input: { systemPrompt: string; userMessage: string; maxTokens?: number }) => Promise<{ text: string }>;
};

/**
 * Run the phrasing pass. Returns null on any failure — caller is responsible
 * for falling back to the raw deterministic shape rather than fabricating.
 */
export async function phraseSummary(
  input: {
    items: ImpactItem[];
    counts: ImpactCategoryCounts;
    signals: InstallSignals;
  },
  deps: PhraseDeps = {},
): Promise<PhrasedImpactSummary | null> {
  if (input.items.length === 0) return null;

  const payload = buildPayload(input.items, input.counts, input.signals);
  const llm = deps.llm ?? callLLM;

  let result;
  try {
    result = await llm({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: JSON.stringify(payload, null, 2),
      maxTokens: 1200,
    });
  } catch (err) {
    console.warn("[impact.phrase] llm call failed", err);
    return null;
  }

  const jsonText = extractJsonObject(result.text);
  if (!jsonText) {
    console.warn("[impact.phrase] no JSON object found in LLM output");
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    console.warn("[impact.phrase] JSON parse failed", err);
    return null;
  }
  const validated = validate(parsed, input.items.length);
  if (!validated) {
    console.warn("[impact.phrase] LLM output failed schema/length validation");
    return null;
  }
  return validated;
}
