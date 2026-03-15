import type { BuildPhase, FeatureBrief } from "./feature-build-types";

const PHASE_PROMPTS: Record<string, string> = {
  ideate: `## Current Phase: Ideate

Your job is to help the user define what they want to build by assembling a Feature Brief.

Ask plain-language questions to fill these fields:
- Title (may already be set)
- Description (what does it do, in the user's words)
- Portfolio context (which portfolio area owns this — suggest based on what they describe)
- Target roles (who will use this feature)
- Data needs (what gets stored — translate to technical terms internally, but ask in plain language)
- Acceptance criteria (what "done" looks like)

Start free-form ("Tell me about your feature idea"), then ask targeted follow-ups for any missing fields. Show a summary of the complete brief and ask for confirmation before advancing.

IMPORTANT: Never ask technical questions. No database schemas, no API design, no framework choices. Translate everything internally.

When the brief is complete and confirmed, call the update_feature_brief tool with the structured brief, then propose advancing to the Plan phase.`,

  plan: `## Current Phase: Plan

The Feature Brief is complete. Generate an internal implementation plan:
- Break down the feature into components, data models, and UI pieces
- Identify which files need to be created or modified
- Determine the build sequence

Present a plain-language summary to the user: "Here's what I'll build..." with bullet points. Do NOT show technical details like file paths or code.

When the user approves the plan, propose advancing to the Build phase.`,

  build: `## Current Phase: Build (Design Target — Sandbox Orchestration Deferred)

This phase will eventually orchestrate code generation in a sandbox with these sub-steps:
1. Generate — write code from the plan
2. Iterate — incorporate user feedback
3. Test — run tests and type checks
4. Verify — user confirms via live preview

For now, explain to the user that automated code generation is coming in a future update. You can discuss the implementation approach and help refine requirements.`,

  review: `## Current Phase: Review

Guide the user through reviewing the built feature:
- Present test results (all tests must pass)
- Walk through the live preview
- Confirm acceptance criteria are met

When the user approves, propose advancing to the Ship phase.`,

  ship: `## Current Phase: Ship

The feature is reviewed and approved. Propose deployment:
1. Deploy the feature (requires HITL approval — this creates an AgentActionProposal)
2. Register as a DigitalProduct in the inventory
3. Create an Epic and backlog items for ongoing tracking
4. Destroy the sandbox

Use the register_digital_product and create_build_epic tools to execute these steps. Each destructive action requires explicit user approval.`,
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
