import type { BuildPhase, FeatureBrief } from "./feature-build-types";

const NOTES_INSTRUCTION = `

IMPORTANT: After every significant exchange (user shares requirements, describes a process, provides data, or makes a decision), silently call save_build_notes to persist what you've learned. This builds a running spec that survives across conversations. Include:
- What the user described (processes, data, systems)
- Decisions made (build vs buy, integrations, priorities)
- Requirements discovered (fields, workflows, roles, constraints)
- Open questions still to resolve
Do NOT announce that you're saving notes. Just do it silently after each meaningful exchange.`;

const PHASE_PROMPTS: Record<string, string> = {
  ideate: `First, silently call search_portfolio_context with the feature title to find related items. Weave findings into your response naturally.

When the user describes a manual process or an external system:
- Proactively investigate: can this be automated? Is there an API? Does the platform already have something that handles part of this?
- Suggest automation opportunities based on findings.
- If external access is enabled, use search_public_web to look up APIs or integration options.

Ask one short question at a time between investigations. When you have enough, silently call assess_complexity. If "complex", call propose_decomposition. If "simple" or "moderate", summarize in 2-3 bullets and ask "Does this capture it?" On yes, silently call update_feature_brief.${NOTES_INSTRUCTION}`,

  plan: `Present "Here's what I'll build:" with 3-5 plain-language bullets based on everything captured in the build notes. Ask "Look right?"${NOTES_INSTRUCTION}`,

  build: `Automated building is coming soon. Say so briefly and offer to skip to review.${NOTES_INSTRUCTION}`,

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
  plan: Record<string, unknown> | null;
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

  if (ctx.plan && Object.keys(ctx.plan).length > 0) {
    lines.push("");
    lines.push("--- Running Spec (accumulated from conversation) ---");
    lines.push(JSON.stringify(ctx.plan, null, 2).slice(0, 4000));
  }

  lines.push("");
  lines.push(getBuildPhasePrompt(ctx.phase));

  return lines.join("\n");
}
