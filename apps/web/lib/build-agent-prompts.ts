import type { BuildPhase, FeatureBrief } from "./feature-build-types";

const PHASE_PROMPTS: Record<string, string> = {
  ideate: `First, silently call search_portfolio_context with the feature title to find related items. Weave findings into your response naturally.

When the user describes a manual process or an external system:
- Proactively investigate: can this be automated? Is there an API? Does the platform already have something that handles part of this?
- Suggest automation opportunities: "This manual step could be automated by..." or "The Open Group has an API for certifications — we could pull data directly instead of manual entry."
- If external access is enabled, use search_public_web to look up APIs or integration options for the systems the user mentions.
- Present your findings as suggestions, not questions: "I found that X has a REST API we could integrate with. That would eliminate the manual data entry step."

Ask one short question at a time between investigations. When you have enough, silently call assess_complexity. If "complex", call propose_decomposition. If "simple" or "moderate", summarize in 2-3 bullets and ask "Does this capture it?" On yes, silently call update_feature_brief.`,

  plan: `Present "Here's what I'll build:" with 3-5 plain-language bullets. Ask "Look right?"`,

  build: `Automated building is coming soon. Say so briefly and offer to skip to review.`,

  review: `Confirm the acceptance criteria are met in 1-2 sentences. Ask "Ready to ship?"`,

  ship: `Silently call register_digital_product_from_build then create_build_epic. Tell the user "Done — registered as a product with tracking set up." Don't ask permission for the epic — just do it after the product is registered.`,
};

export function getBuildPhasePrompt(phase: BuildPhase): string {
  return PHASE_PROMPTS[phase] ?? "";
}

export type BuildContext = {
  buildId: string;
  phase: BuildPhase;
  title: string;
  brief: FeatureBrief | null;
  portfolioId: string | null;
};

export function getBuildContextSection(ctx: BuildContext): string {
  const lines: string[] = [
    "",
    "--- Build Studio Context ---",
    `Build ID: ${ctx.buildId}`,
    `Title: ${ctx.title}`,
    `Phase: ${ctx.phase}`,
  ];

  if (ctx.portfolioId) {
    lines.push(`Portfolio: ${ctx.portfolioId}`);
  }

  if (ctx.brief) {
    lines.push("");
    lines.push("Feature Brief:");
    lines.push(`  Title: ${ctx.brief.title}`);
    lines.push(`  Description: ${ctx.brief.description}`);
    lines.push(`  Portfolio: ${ctx.brief.portfolioContext}`);
    lines.push(`  Target roles: ${ctx.brief.targetRoles.join(", ")}`);
    lines.push(`  Acceptance criteria: ${ctx.brief.acceptanceCriteria.join("; ")}`);
  }

  lines.push("");
  lines.push(getBuildPhasePrompt(ctx.phase));

  return lines.join("\n");
}
