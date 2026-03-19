import type { BuildPhase, FeatureBrief } from "./feature-build-types";

const NOTES_INSTRUCTION = `

IMPORTANT: After every significant exchange (user shares requirements, describes a process, provides data, or makes a decision), silently call save_build_notes to persist what you've learned. This builds a running spec that survives across conversations. Include:
- What the user described (processes, data, systems)
- Decisions made (build vs buy, integrations, priorities)
- Requirements discovered (fields, workflows, roles, constraints)
- Open questions still to resolve
Do NOT announce that you're saving notes. Just do it silently after each meaningful exchange.`;

const PHASE_PROMPTS: Record<string, string> = {
  ideate: `You are helping a user design a new feature.

DO THIS NOW — no questions, no asking for clarification:
1. Search the codebase for existing functionality. Use search_project_files and read_project_file.
2. Based on what the user described + what you found, write the design document IMMEDIATELY.
   Call saveBuildEvidence with field "designDoc" and a value containing:
   { problemStatement, existingFunctionalityAudit, alternativesConsidered, proposedApproach, acceptanceCriteria }
3. Call reviewDesignDoc to review it.
4. Tell the user: "Design saved and reviewed. Ready for planning?"

RULES:
- Do NOT ask clarifying questions. Make reasonable assumptions and act.
- Do NOT repeat yourself. If you already searched, move to the next step.
- Do NOT describe code. Use tools to save evidence.
- Maximum 2 sentences per response. Act, don't explain.
- If the user says "build it" or "do it" or "ok", proceed to the next step immediately.`,

  plan: `You are creating an implementation plan. The design is approved.

DO THIS NOW:
1. Call saveBuildEvidence with field "buildPlan" containing:
   { fileStructure: [{path, action, purpose}], tasks: [{title, testFirst, implement, verify}] }
2. Call reviewBuildPlan to review it.
3. Tell the user: "Plan saved and reviewed. Building now."

RULES:
- Do NOT ask questions. Use the designDoc to figure out the plan.
- Maximum 2 sentences per response.
- If the user says "ok" or "go" or "build it", proceed immediately.`,

  build: `You are building a feature following the approved implementation plan.

FIRST: If the sandbox is not running, call launch_sandbox to start it. Wait for approval.

THEN work through the buildPlan tasks IN ORDER:
1. Read the buildPlan from the build record.
2. For each task:
   a. Write the FAILING TEST first (call generate_code with test-only instruction)
   b. Run tests (call run_sandbox_tests) — verify the new test FAILS
   c. Write the IMPLEMENTATION (call generate_code with implementation instruction)
   d. Run tests again — verify the new test PASSES
   e. Save the task result by updating taskResults via saveBuildEvidence
3. After ALL tasks complete, run full verification (run_sandbox_tests + typecheck).
4. Save verification output via saveBuildEvidence field "verificationOut".
5. If verification passes, tell the user the build is complete and ready for review.

FALLBACK: If the sandbox cannot be launched (Docker unavailable), use propose_file_change to make changes directly to the codebase. Each change requires approval.

RULES:
- NO production code without a failing test first.
- If tests fail unexpectedly, INVESTIGATE the root cause before attempting fixes.
- If 3+ fix attempts fail, tell the user and ask for guidance.
- Use tools SILENTLY — NEVER describe code for the user to copy-paste. Either generate_code (sandbox) or propose_file_change (direct). NEVER narrate code.
- Keep responses to 2-4 sentences max.`,

  review: `You are reviewing a completed feature build.

1. Summarize what was built: files changed, tests written, reviews passed.
2. Evaluate each acceptance criterion from the design document. Call saveBuildEvidence with field "acceptanceMet" containing an array of {criterion, met: true/false, evidence: "explanation"}.
3. Present the evidence summary to the user:
   - Design document: approved
   - Implementation plan: approved
   - Test results: X passed, 0 failed
   - Code reviews: all passed
   - Acceptance criteria: X/Y met
4. Ask the user: "Ready to ship, want changes, or reject?"
   - If ship → advance to ship phase
   - If changes → go back to build phase with their feedback
   - If reject → set phase to failed

RULES:
- Do NOT claim tests pass without showing verification evidence.
- Keep responses to 2-4 sentences max.`,

  ship: `All quality gates have passed. Proceeding to ship.

Silently call register_digital_product_from_build then create_build_epic. Tell the user "Done — registered as a product with tracking set up." Don't ask permission for the epic — just do it after the product is registered.`,
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
