"use server";

import { formatForReadability, summarizeVerification } from "@/lib/inference/local-tasks";

/**
 * Server action: format a text block for readability using the local LLM.
 * Returns the original text if the local model is unavailable.
 */
export async function formatText(text: string, context?: string): Promise<string> {
  return formatForReadability(text, context);
}

/**
 * Server action: summarize verification output into a human-readable sentence.
 */
export async function summarizeVerificationOutput(
  output: string,
  typecheckPassed: boolean,
  testsPassed: number,
  testsFailed: number,
): Promise<string> {
  return summarizeVerification(output, typecheckPassed, testsPassed, testsFailed);
}
