/**
 * EP-INF-001-P6: Dimension-specific scoring functions for golden tests.
 * Each function scores a single response on a 0-10 scale.
 * scoreDimension normalizes an array of per-test scores to 0-100.
 */

/** Exact match: response contains the expected string (case-insensitive). */
export function scoreExact(response: string, expected: string): number {
  const normalized = response.trim().toLowerCase();
  const target = expected.trim().toLowerCase();
  return normalized.includes(target) ? 10 : 0;
}

/** Partial credit: 10 for key content present, 5 for related but imprecise, 0 for wrong. */
export function scorePartial(response: string, expected: string): number {
  const normalized = response.toLowerCase();
  const target = expected.toLowerCase();
  // Full match — key content present
  if (normalized.includes(target)) return 10;
  // Partial — shares significant keywords (>50% of expected words found)
  const expectedWords = target.split(/\s+/).filter((w) => w.length > 3);
  const matchCount = expectedWords.filter((w) => normalized.includes(w)).length;
  if (expectedWords.length > 0 && matchCount / expectedWords.length > 0.5) return 5;
  return 0;
}

/** Schema validation: 10 for valid JSON matching schema, 5 for valid JSON partial match, 0 for invalid. */
export function scoreSchema(
  response: string,
  schema: Record<string, unknown>,
): number {
  // Extract JSON from response (may be wrapped in markdown code fences)
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) ??
    response.match(/(\{[\s\S]*\})/) ??
    response.match(/(\[[\s\S]*\])/);
  const jsonStr = jsonMatch ? jsonMatch[1]!.trim() : response.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return 0;
  }

  // Basic type check
  const expectedType = schema.type as string;
  if (expectedType === "object" && (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null)) return 5;
  if (expectedType === "array" && !Array.isArray(parsed)) return 5;

  // Required fields check
  const required = (schema.required as string[]) ?? [];
  if (expectedType === "object" && typeof parsed === "object" && parsed !== null) {
    const keys = Object.keys(parsed as Record<string, unknown>);
    const missingRequired = required.filter((r) => !keys.includes(r));
    if (missingRequired.length > 0) return 5;
  }

  // Array length check
  if (expectedType === "array" && Array.isArray(parsed)) {
    const minItems = schema.minItems as number | undefined;
    const maxItems = schema.maxItems as number | undefined;
    if (minItems !== undefined && parsed.length < minItems) return 5;
    if (maxItems !== undefined && parsed.length > maxItems) return 5;
  }

  return 10;
}

/** Tool call validation: correct tool called, correct abstention. */
export function scoreToolCall(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  expected: string,
): number {
  if (expected === "__ABSTAIN__") {
    return toolCalls.length === 0 ? 10 : 0;
  }
  const called = toolCalls.find((tc) => tc.name === expected);
  return called ? 10 : 0;
}

/** Structural code analysis: checks for expected function definition patterns. */
export function scoreStructural(response: string, expectedPattern: string): number {
  // Extract code from markdown fences if present
  const codeMatch = response.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  const code = codeMatch ? codeMatch[1]!.trim() : response;

  // Check for the expected pattern (e.g., "function isPalindrome")
  if (code.includes(expectedPattern)) return 10;

  // Check if response contains any function/code at all
  const hasCode = /(?:function\s+\w+|const\s+\w+\s*=|=>\s*\{|class\s+\w+)/.test(code);
  return hasCode ? 5 : 0;
}

/** Retrieval accuracy: expected value found in response. */
export function scoreRetrieval(response: string, expected: string): number {
  return response.toLowerCase().includes(expected.toLowerCase()) ? 10 : 0;
}

/** Normalize an array of per-test scores (each 0-10) to a single 0-100 dimension score. */
export function scoreDimension(scores: number[]): number {
  if (scores.length === 0) return 0;
  const total = scores.reduce((a, b) => a + b, 0);
  const maxPossible = scores.length * 10;
  return Math.round((total / maxPossible) * 100);
}
