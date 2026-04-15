/**
 * Local LLM Tasks — lightweight inference for cheap formatting, summarization,
 * and text processing using the Docker Model Runner (Gemma/TinyLlama).
 *
 * These tasks bypass the full routing pipeline and call the local model
 * directly. They are designed for non-critical, latency-tolerant operations
 * like formatting design docs, generating test step descriptions, and
 * summarizing verification output.
 *
 * If the local model is unavailable, functions return the input unchanged
 * rather than failing — graceful degradation, not hard dependency.
 */

import { prisma } from "@dpf/db";

// ─── Config ─────────────────────────────────────────────────────────────────

function getLocalBaseUrl(): string {
  return process.env.LLM_BASE_URL ?? "http://model-runner.docker.internal/v1";
}

async function getLocalModelId(): Promise<string | null> {
  // Check what the seed/bootstrap selected for this hardware
  const profile = await prisma.modelProfile.findFirst({
    where: { providerId: "local", modelStatus: "active" },
    select: { modelId: true },
    orderBy: { reasoning: "desc" },
  });
  return profile?.modelId ?? null;
}

// ─── Core Request ───────────────────────────────────────────────────────────

async function localComplete(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 1024,
): Promise<string | null> {
  const modelId = await getLocalModelId();
  if (!modelId) return null;

  const baseUrl = getLocalBaseUrl();

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ─── Task Functions ─────────────────────────────────────────────────────────

/**
 * Format a wall of text into a readable summary with bullet points and headers.
 * Used for design doc sections (proposedApproach, dataModel, etc.).
 * Returns original text if local model is unavailable.
 */
export async function formatForReadability(
  text: string,
  context?: string,
): Promise<string> {
  if (!text || text.length < 100) return text;

  const result = await localComplete(
    "You are a technical writer. Reformat the following text into a clear, scannable format with markdown headers and bullet points. Keep ALL technical details — do not remove or summarize away information. Just make it readable.",
    context
      ? `Context: ${context}\n\n---\n\n${text}`
      : text,
    2048,
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
    // Try local model for a natural summary
    const summary = await localComplete(
      "Summarize the TypeScript errors in one sentence. Example: '3 type errors in complaints.ts: missing property, wrong return type, undefined import'. Be specific about files and error types.",
      output.slice(0, 3000),
      256,
    );
    parts.push(summary ?? "TypeScript: errors found (see raw output)");
  }

  if (testsPassed > 0 || testsFailed > 0) {
    if (testsFailed === 0) {
      parts.push(`Tests: all ${testsPassed} passed`);
    } else {
      const testSummary = await localComplete(
        "Summarize the test failures in one sentence. Example: '1 assertion failed in store.test.ts: expected status open, got undefined'. Be specific.",
        output.slice(0, 3000),
        256,
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

  const result = await localComplete(
    `You are a QA engineer writing manual test steps for a feature called "${featureTitle}". For each acceptance criterion, write 1-3 concrete test steps a non-technical user can follow. Format each line as: CRITERION_NUMBER|Step instruction. Example:\n1|Navigate to /complaints\n1|Click the New Complaint button\n1|Fill in the subject and description fields\n2|Check the complaints list shows the new entry`,
    criteriaText,
    1024,
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

/**
 * Check if a local model is available for lightweight tasks.
 */
export async function isLocalModelAvailable(): Promise<boolean> {
  const modelId = await getLocalModelId();
  if (!modelId) return false;

  try {
    const res = await fetch(`${getLocalBaseUrl()}/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
