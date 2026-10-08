// Marketing execution loop — content drafter.
//
// Turns a saved MarketingAssetTask brief into a channel-shaped,
// human-reviewable OutboundDraft. Phase 1: LinkedIn posts and email assets
// only. Other asset types (ads, carousel, video script) ship in later
// phases and add their own shaping helpers here.
//
// Reference spec:
//   docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md
// Reference plan:
//   docs/superpowers/plans/2026-05-26-marketing-execution-loop-phase-1.md

import { prisma } from "@dpf/db";
import {
  type OutboundBodyFormat,
  type OutboundDraftStatus,
} from "./execution";
import { getMarketingWorkspaceSnapshot, type MarketingWorkspaceSnapshot } from "../marketing";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { platformLeakTermsFor } from "./archetype-fit";
import {
  PLATFORM_CLAIM_LIMITS,
  describeBuyerForPrompt,
  resolveBuyerArchetype,
  sellsThePlatform,
} from "./buyer-archetype-value";

export type DraftMarketingAssetResult =
  | {
      success: true;
      draftId: string;
      status: OutboundDraftStatus;
      bodyFormat: OutboundBodyFormat;
      wordCount: number;
      channelId: string;
      assetType: string;
      message: string;
    }
  | { success: false; error: string; message: string };

const LINKEDIN_POST_GUIDE = `LinkedIn post shape:
- Hook in line 1 — pain-led, specific, no generic openers like "I've been thinking…".
- Target 180–280 words. Concrete examples beat abstractions.
- Use short paragraphs (1–3 lines). Whitespace makes mobile readable.
- 0–3 hashtags max, only ones this business's actual audience would search.
- Exactly one call to action at the end, matching the business's booking/inquiry/purchase motion.
- No emoji-flood, no "🚀". Use the business's own voice, not generic corporate marketing voice.`;

const EMAIL_GUIDE = `Email shape:
- First line: subject (prefix with "Subject: "). Concise, curiosity-led, no clickbait.
- Body: short paragraphs. 100–220 words total.
- Personalize the opener if PAGE DATA includes a recipient signal; otherwise lead with the recipient's likely problem.
- One ask in the body. One link or one reply prompt — never both.
- Sign-off with a name placeholder ({{senderName}}) so the sender substitutes it before send.`;

const AD_CREATIVE_GUIDE = `Ad creative shape (placeholder for Phase 4 — Phase 1 should not draft ad creatives yet, return a needs-changes diagnostic instead).`;

function shapingGuide(assetType: string): string {
  const normalized = assetType.toLowerCase();
  if (normalized.includes("linkedin")) return LINKEDIN_POST_GUIDE;
  if (normalized.includes("email")) return EMAIL_GUIDE;
  if (normalized.includes("ad")) return AD_CREATIVE_GUIDE;
  return LINKEDIN_POST_GUIDE;
}

function isSupportedAssetType(assetType: string): boolean {
  const normalized = assetType.toLowerCase();
  return normalized.includes("linkedin") || normalized.includes("email");
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The business voice and audience the drafter writes in.
 *
 * Archetype voice: the drafter speaks in THIS business's language, not generic
 * software-startup voice — the playbook supplies stakeholders, tone and CTAs
 * (a restaurant markets covers, bookings and menus, never "technical founders").
 * The terms it must avoid are exactly the ones the fit guard would block, so a
 * business whose own offer is the platform may name it (BI-E92B6BC9).
 *
 * A business that sells the platform markets to OTHER archetypes: when the task
 * names a buyer archetype ("HVAC contractors"), that buyer's benefits and claim
 * boundary steer the copy (BI-B4BE6934).
 */
export function buildDraftVoice(input: {
  snapshot: Pick<MarketingWorkspaceSnapshot, "storefront" | "strategy">;
  taskText: string;
}): { audience: string; archetypeVoice: string } {
  const { snapshot } = input;
  const playbook = getPlaybook(snapshot.storefront.category, snapshot.storefront.ctaType);
  const bannedTerms = platformLeakTermsFor({
    category: snapshot.storefront.category,
    ownOffer: snapshot.storefront.ownOffer,
  });
  const buyer = sellsThePlatform(snapshot.storefront.ownOffer)
    ? resolveBuyerArchetype(input.taskText)
    : null;

  const audience =
    buyer?.label
    ?? snapshot.strategy.targetSegments[0]?.name
    ?? snapshot.strategy.idealCustomerProfiles[0]?.name
    ?? "the strategist's chosen buyer segment";

  const lines = [
    `This business is a ${
      snapshot.storefront.archetypeName ?? snapshot.storefront.category ?? "local business"
    }.`,
    `- Audience: ${buyer ? `${buyer.label} — ${buyer.whoTheyAre}` : playbook.stakeholders}.`,
    `- Voice: ${playbook.contentTone}.`,
    `- Speak in this business's own concepts. Preferred calls to action: ${playbook.ctaLanguage.join(", ")}.`,
    bannedTerms.length > 0
      ? `- NEVER use these terms — they are not what this business sells: ${bannedTerms.join(", ")}. This is a real business marketing to real customers.`
      : null,
    buyer
      ? `- Write for this buyer, in their terms, about their day — not about the platform's internals:\n${describeBuyerForPrompt(buyer)}`
      : null,
    sellsThePlatform(snapshot.storefront.ownOffer) ? `- ${PLATFORM_CLAIM_LIMITS}` : null,
  ].filter((line): line is string => line !== null);

  return { audience, archetypeVoice: lines.join("\n") };
}

export async function draftMarketingAsset(input: {
  assetTaskId: string;
  channelOverride?: string;
  toneNotes?: string;
  createdByAgentId: string | null;
}): Promise<DraftMarketingAssetResult> {
  const task = await prisma.marketingAssetTask.findUnique({
    where: { taskId: input.assetTaskId },
  });
  if (!task) {
    return {
      success: false,
      error: "Asset task not found",
      message: `MarketingAssetTask ${input.assetTaskId} does not exist; cannot draft.`,
    };
  }

  if (!isSupportedAssetType(task.assetType)) {
    return {
      success: false,
      error: "Unsupported asset type for Phase 1",
      message: `assetType=${JSON.stringify(task.assetType)} is not yet drafted by Phase 1 (LinkedIn posts and emails only). Ads and other shapes land in later phases.`,
    };
  }

  const snapshot = await getMarketingWorkspaceSnapshot();
  if (!snapshot) {
    return {
      success: false,
      error: "No marketing workspace",
      message: "Cannot draft without a configured marketing workspace.",
    };
  }

  const channelId = input.channelOverride ?? task.channel ?? "linkedin";
  const positioning = snapshot.latestReview?.summary
    ?? "No saved strategist review — drafter is operating without a positioning anchor.";
  const voice = buildDraftVoice({
    snapshot,
    taskText: [task.title, task.brief].filter(Boolean).join("\n"),
  });
  const audience = voice.audience;
  const proof =
    snapshot.strategy.proofAssets[0]?.label ?? null;
  const archetypeVoice = voice.archetypeVoice;

  const systemPrompt = `You are a senior marketing copywriter producing channel-shaped, ready-to-publish copy from a marketing brief.

You produce the body the human will review next. Do NOT produce meta-commentary, options, or "here are three variants" — produce ONE draft, the one you'd publish if you had the authority. The human reviews and edits before any external publish.

${shapingGuide(task.assetType)}

Business voice (stay inside this — it defines who you are writing as):
${archetypeVoice}

Constraints:
- Stay grounded in the brief and the positioning. Do not invent product features that aren't in the brief.
- Use the strategist's stakeholder language and the business voice above.
- No placeholders like [Insert X] except the explicit signer placeholder in email sign-offs.`;

  const userPrompt = `Brief title: ${task.title}
Asset type: ${task.assetType}
Channel: ${channelId}
Due window: ${task.dueWindow ?? "not specified"}

Brief instructions:
${task.brief ?? "(no brief — use the positioning + audience anchors)"}

Positioning anchor (latest strategist review):
${positioning}

Audience anchor: ${audience}
${proof ? `Proof asset anchor: ${proof}` : ""}
${input.toneNotes ? `Tone notes: ${input.toneNotes}` : ""}

Produce the ${task.assetType} now. Output the body only — no preamble, no commentary.`;

  const { routeAndCall } = await import("../routed-inference");
  const result = await routeAndCall(
    [{ role: "user", content: userPrompt }],
    systemPrompt,
    "internal",
  );

  const body = (result?.content ?? "").trim();
  if (!body) {
    return {
      success: false,
      error: "Drafter returned empty body",
      message: "The drafter produced an empty response; retry with a more specific brief or tone note.",
    };
  }

  const draft = await prisma.outboundDraft.create({
    data: {
      organizationId: snapshot.organization.id,
      domain: "marketing",
      sourceType: "marketing-asset-task",
      sourceId: task.taskId,
      strategyId: snapshot.strategy.strategyId,
      status: "pending-review",
      channelId,
      assetType: task.assetType,
      body,
      bodyFormat: "markdown",
      metadata: {
        assetTaskTitle: task.title,
        assetTaskDueWindow: task.dueWindow,
      },
      createdByAgentId: input.createdByAgentId,
    },
    select: { draftId: true, status: true, bodyFormat: true, body: true, channelId: true, assetType: true },
  });

  const wordCount = countWords(draft.body);
  return {
    success: true,
    draftId: draft.draftId,
    status: draft.status as OutboundDraftStatus,
    bodyFormat: draft.bodyFormat as OutboundBodyFormat,
    wordCount,
    channelId: draft.channelId,
    assetType: draft.assetType,
    message: `Drafted ${wordCount}-word ${draft.assetType} for review on /customer/marketing.`,
  };
}
