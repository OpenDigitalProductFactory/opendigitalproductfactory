/**
 * Cheap LLM Tasks — lightweight inference for formatting, summarization,
 * and text processing routed through the platform's cost-optimized pipeline.
 *
 * Uses `routeAndCall()` with `budgetClass: "minimize_cost"` so the routing
 * system picks the cheapest available model — local Gemma/TinyLlama if
 * Docker Model Runner is running, Haiku if not, whatever the platform has.
 *
 * If no model is available at all, functions return the input unchanged
 * rather than failing — graceful degradation, not hard dependency.
 */

import type { ChatMessage } from "@/lib/ai-inference";

// ─── Core Request ───────────────────────────────────────────────────────────

async function cheapComplete(
  systemPrompt: string,
  userMessage: string,
): Promise<string | null> {
  try {
    const { routeAndCall } = await import("@/lib/routed-inference");

    const messages: ChatMessage[] = [
      { role: "user", content: userMessage },
    ];

    const result = await routeAndCall(messages, systemPrompt, "internal", {
      taskType: "formatting",
      budgetClass: "minimize_cost",
    });

    return result.content?.trim() || null;
  } catch {
    // No eligible endpoints, routing failure, or inference error — degrade gracefully
    return null;
  }
}

// ─── Task Functions ─────────────────────────────────────────────────────────

/**
 * Format a wall of text into a readable summary with bullet points and headers.
 * Used for design doc sections (proposedApproach, dataModel, etc.).
 * Returns original text if no model is available.
 */
export async function formatForReadability(
  text: string,
  context?: string,
): Promise<string> {
  if (!text || text.length < 100) return text;

  const result = await cheapComplete(
    "You are a technical writer. Reformat the following text into a clear, scannable format with markdown headers and bullet points. Keep ALL technical details — do not remove or summarize away information. Just make it readable.",
    context
      ? `Context: ${context}\n\n---\n\n${text}`
      : text,
  );

  return result ?? text;
}

/**
 * Summarize verification output into a human-readable explanation.
 * Returns a short explanation like "3 TypeScript errors in complaints.ts"
 * or "Tests: 2 passed, 1 failed (assertion error in store.test.ts)".
 */
export async function summarizeVerification(
  output: string,
  typecheckPassed: boolean,
  testsPassed: number,
  testsFailed: number,
): Promise<string> {
  const parts: string[] = [];

  if (typecheckPassed) {
    parts.push("TypeScript: clean");
  } else {
    const summary = await cheapComplete(
      "Summarize the TypeScript errors in one sentence. Example: '3 type errors in complaints.ts: missing property, wrong return type, undefined import'. Be specific about files and error types.",
      output.slice(0, 3000),
    );
    parts.push(summary ?? "TypeScript: errors found (see raw output)");
  }

  if (testsPassed > 0 || testsFailed > 0) {
    if (testsFailed === 0) {
      parts.push(`Tests: all ${testsPassed} passed`);
    } else {
      const testSummary = await cheapComplete(
        "Summarize the test failures in one sentence. Example: '1 assertion failed in store.test.ts: expected status open, got undefined'. Be specific.",
        output.slice(0, 3000),
      );
      parts.push(testSummary ?? `Tests: ${testsPassed} passed, ${testsFailed} failed`);
    }
  }

  return parts.join(". ");
}

/**
 * Generate manual test steps from acceptance criteria.
 * Converts "User can submit a complaint" into
 * "1. Navigate to /complaints, 2. Click New Complaint, 3. Fill form..."
 */
export async function generateTestSteps(
  criteria: Array<{ criterion: string; met: boolean }>,
  featureTitle: string,
): Promise<Array<{ step: number; instruction: string; criterion: string }>> {
  if (criteria.length === 0) return [];

  const criteriaText = criteria
    .map((c, i) => `${i + 1}. ${c.criterion}`)
    .join("\n");

  const result = await cheapComplete(
    `You are a QA engineer writing manual test steps for a feature called "${featureTitle}". For each acceptance criterion, write 1-3 concrete test steps a non-technical user can follow. Format each line as: CRITERION_NUMBER|Step instruction. Example:\n1|Navigate to /complaints\n1|Click the New Complaint button\n1|Fill in the subject and description fields\n2|Check the complaints list shows the new entry`,
    criteriaText,
  );

  if (!result) {
    // Fallback: use criteria as-is
    return criteria.map((c, i) => ({
      step: i + 1,
      instruction: `Verify: ${c.criterion}`,
      criterion: c.criterion,
    }));
  }

  // Parse the numbered response
  const steps: Array<{ step: number; instruction: string; criterion: string }> = [];
  for (const line of result.split("\n")) {
    const match = line.match(/^(\d+)\|(.+)/);
    if (match) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < criteria.length) {
        steps.push({
          step: steps.length + 1,
          instruction: match[2].trim(),
          criterion: criteria[idx].criterion,
        });
      }
    }
  }

  return steps.length > 0 ? steps : criteria.map((c, i) => ({
    step: i + 1,
    instruction: `Verify: ${c.criterion}`,
    criterion: c.criterion,
  }));
}
