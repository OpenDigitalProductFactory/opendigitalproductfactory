import type { BuildPhase, FeatureBrief } from "./feature-build-types";

const PHASE_PROMPTS: Record<string, string> = {
  ideate: `First, silently call search_portfolio_context with the feature title to find related items. If matches are found, weave them into your first question: "This relates to [product X] in [portfolio Y]" or "There's an open backlog item for this."

Then ask one short question at a time. When you have enough, silently call assess_complexity with your scores. If the path is "complex", call propose_decomposition and present the breakdown conversationally. If "simple" or "moderate", summarize in 2-3 bullets and ask "Does this capture it?" On yes, silently call update_feature_brief.`,

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
