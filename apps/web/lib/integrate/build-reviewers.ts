// apps/web/lib/build-reviewers.ts
// Reviewer agents for Build Disciplines. Each reviewer is an LLM call
// that validates evidence and returns a structured ReviewResult.

import type { ReviewResult, BuildDesignDoc, BuildPlanDoc } from "@/lib/feature-build-types";

// ─── Prompt Templates ────────────────────────────────────────────────────────

export function buildDesignReviewPrompt(doc: BuildDesignDoc, projectContext: string): string {
  return `You are reviewing a design document for a platform feature.

DESIGN DOCUMENT:
Problem: ${doc.problemStatement}
Existing Functionality Audit: ${doc.existingFunctionalityAudit}
Alternatives Considered: ${doc.alternativesConsidered}
Reuse Plan: ${doc.reusePlan}
New Code Justification: ${doc.newCodeJustification}
Proposed Approach: ${doc.proposedApproach}
Acceptance Criteria: ${Array.isArray(doc.acceptanceCriteria) ? doc.acceptanceCriteria.join("; ") : doc.acceptanceCriteria ?? "Not specified"}

PROJECT CONTEXT:
${projectContext}

REVIEW CHECKLIST:
1. Is the problem statement clear and specific?
2. Was existing functionality properly audited (not building what already exists)?
3. Were alternatives considered (open-source, existing tools, MCP services)?
4. Is the reuse plan concrete (not vague)?
5. Is new code justified where reuse wasn't possible?
6. Is the proposed approach sound?
7. Are acceptance criteria testable and specific?
8. Does the design consider accessibility? (semantic HTML structure, keyboard-navigable interactions, ARIA labels for non-text interactive elements, color not the sole conveyor of meaning)

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

export function buildPlanReviewPrompt(plan: BuildPlanDoc): string {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const files = Array.isArray(plan?.fileStructure) ? plan.fileStructure : [];
  const taskList = tasks.map((t, i) => `  ${i + 1}. ${t?.title ?? "Untitled"}: test="${t?.testFirst ?? ""}" impl="${t?.implement ?? ""}" verify="${t?.verify ?? ""}"`).join("\n") || "  (no tasks defined)";
  const fileList = files.map((f) => `  ${f?.action ?? "?"}: ${f?.path ?? "?"} — ${f?.purpose ?? ""}`).join("\n") || "  (no file structure defined)";

  return `You are reviewing an implementation plan for a platform feature.

FILE STRUCTURE:
${fileList}

TASKS:
${taskList}

REVIEW CHECKLIST:
1. Are tasks bite-sized (each should be 2-5 minutes of work)?
2. Does each task have a test-first step?
3. Are file paths specific (not vague)?
4. Is the file structure sensible (one responsibility per file)?
5. Are there any missing tasks for the described file changes?

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

export function buildCodeReviewPrompt(taskTitle: string, codeChanges: string, testOutput: string): string {
  return `You are reviewing code changes for a single build task.

TASK: ${taskTitle}

CODE CHANGES:
${codeChanges}

TEST OUTPUT:
${testOutput}

REVIEW CHECKLIST:
1. Does a test exist that covers this change?
2. Is there code duplication with existing functionality?
3. Does the code follow project patterns (TypeScript, Next.js, Tailwind)?
4. Are there security concerns (injection, XSS, etc.)?
5. Is the code clean and maintainable?
6. Does the code use CSS variables (var(--dpf-*)) for all colors — no text-white, bg-white, text-black, bg-black, or inline hex values? (Exception: text-white on accent-background buttons, semantic status colors from ThemeTokens.states)
7. Are interactive elements keyboard-accessible with visible focus indicators? Do form inputs have associated labels? Do buttons have descriptive accessible names?

RESPOND WITH EXACTLY THIS JSON FORMAT (no other text):
{
  "decision": "pass" or "fail",
  "issues": [{"severity": "critical|important|minor", "description": "..."}],
  "summary": "one sentence summary"
}`;
}

// ─── Response Parsing ────────────────────────────────────────────────────────

export function parseReviewResponse(raw: string): ReviewResult {
  try {
    // Extract JSON from response (may have markdown code fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const decision = parsed.decision === "pass" ? "pass" : "fail";
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((issue: Record<string, unknown>) => ({
          severity: (["critical", "important", "minor"].includes(String(issue.severity))
            ? String(issue.severity)
            : "minor") as "critical" | "important" | "minor",
          description: String(issue.description ?? ""),
          location: issue.location ? String(issue.location) : undefined,
          suggestion: issue.suggestion ? String(issue.suggestion) : undefined,
        }))
      : [];
    const summary = String(parsed.summary ?? "Review complete");

    return { decision, issues, summary };
  } catch {
    // If parsing fails, return a fail result
    return {
      decision: "fail",
      issues: [{ severity: "critical", description: "Review agent returned unparseable response" }],
      summary: "Review failed — could not parse agent response",
    };
  }
}
