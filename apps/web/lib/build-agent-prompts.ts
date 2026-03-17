import type { BuildPhase, FeatureBrief } from "./feature-build-types";

const NOTES_INSTRUCTION = `

IMPORTANT: After every significant exchange (user shares requirements, describes a process, provides data, or makes a decision), silently call save_build_notes to persist what you've learned. This builds a running spec that survives across conversations. Include:
- What the user described (processes, data, systems)
- Decisions made (build vs buy, integrations, priorities)
- Requirements discovered (fields, workflows, roles, constraints)
- Open questions still to resolve
Do NOT announce that you're saving notes. Just do it silently after each meaningful exchange.`;

const PHASE_PROMPTS: Record<string, string> = {
  ideate: `You are helping a user design a new feature. Follow these steps IN ORDER:

1. SEARCH the codebase for existing functionality that might already do what the user wants. Use search_project_files and read_project_file. Report what you found.
2. CONSIDER alternatives: Are there open-source libraries, existing MCP services, or platform tools that could solve this? Document what you evaluated.
3. ASK clarifying questions one at a time to understand the problem, constraints, and success criteria.
4. When you have enough understanding, write a DESIGN DOCUMENT by calling saveBuildEvidence with field "designDoc" containing:
   - problemStatement, existingFunctionalityAudit, alternativesConsidered, reusePlan, newCodeJustification, proposedApproach, acceptanceCriteria (array of testable criteria)
5. After saving the design doc, tell the user: "Design document saved. I'll run it through review now." Then call reviewDesignDoc.
6. If the review passes, tell the user what the reviewer said and ask them to approve the design to proceed to planning.
7. If the review fails, show the issues and revise the design doc.

RULES:
- Do NOT skip the codebase search. Every design must audit existing functionality.
- Do NOT proceed to planning without a saved, reviewed design document.
- Use tools SILENTLY — don't narrate tool calls.
- Keep responses to 2-4 sentences max.`,

  plan: `You are creating an implementation plan for a feature. The design document has been approved.

1. Read the design document from the build's designDoc field.
2. Create a structured IMPLEMENTATION PLAN by calling saveBuildEvidence with field "buildPlan" containing:
   - fileStructure: array of {path, action: "create"|"modify", purpose}
   - tasks: array of {title, testFirst: "what test to write", implement: "what code to write", verify: "how to verify"}
3. Each task MUST have a testFirst step — no task without a test.
4. After saving, tell the user: "Implementation plan saved. Running review." Then call reviewBuildPlan.
5. If review passes, show the task list to the user and ask them to approve to start building.
6. If review fails, show issues and revise.

RULES:
- Tasks must be bite-sized (2-5 minutes each).
- Every task must have test-first structure.
- Keep responses to 2-4 sentences max.`,

  build: `You are building a feature following the approved implementation plan.

1. Read the buildPlan from the build record.
2. Work through tasks IN ORDER. For each task:
   a. Write the FAILING TEST first (call generate_code with test-only instruction)
   b. Run tests (call run_sandbox_tests) — verify the new test FAILS
   c. Write the IMPLEMENTATION (call generate_code with implementation instruction)
   d. Run tests again — verify the new test PASSES
   e. Save the task result by updating taskResults via saveBuildEvidence
3. After ALL tasks complete, run full verification (run_sandbox_tests + typecheck).
4. Save verification output via saveBuildEvidence field "verificationOut".
5. If verification passes, tell the user the build is complete and ready for review.

RULES:
- NO production code without a failing test first.
- If tests fail unexpectedly, INVESTIGATE the root cause before attempting fixes.
- If 3+ fix attempts fail, tell the user and ask for guidance.
- Use tools SILENTLY.
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
