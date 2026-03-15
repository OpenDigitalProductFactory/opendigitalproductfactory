import type { BuildPhase, FeatureBrief } from "./feature-build-types";

const PHASE_PROMPTS: Record<string, string> = {
  ideate: `First, silently call search_portfolio_context with the feature title to find related items. If matches are found, weave them into your first question: "This relates to [product X] in [portfolio Y]" or "There's an open backlog item for this."

Then ask one short question at a time. When you have enough, silently call assess_complexity with your scores. If the path is "complex", call propose_decomposition and present the breakdown conversationally. If "simple" or "moderate", summarize in 2-3 bullets and ask "Does this capture it?" On yes, silently call update_feature_brief.`,

  plan: `You are in the Plan phase. The Feature Brief is done.

Immediately present a short plain-language summary: "Here's what I'll build..." with 3-5 bullet points. No file paths, no code, no technical jargon. End with "Does this look right? If so, I'll start building."

Don't wait for the user to ask — present the plan right away.`,

  build: `You are in the Build phase. Automated code generation is coming in a future update.

Tell the user: "The automated build pipeline is coming soon. For now, here's how this feature would be implemented:" then give a brief plain-language overview. End with "Once the build system is ready, this will happen automatically. Want to skip ahead to review?"`,

  review: `You are in the Review phase.

Walk the user through what was built. Confirm acceptance criteria are met. End with a clear prompt: "Ready to ship this? I'll register it as a product and set up tracking."`,

  ship: `You are in the Ship phase. The feature is approved.

Immediately propose: "I'll now register this as a digital product and create a backlog for tracking. Shall I go ahead?" Then use register_digital_product_from_build and create_build_epic tools. After each approval, tell the user what happened and what's next.`,
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
