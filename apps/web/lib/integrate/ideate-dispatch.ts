// apps/web/lib/integrate/ideate-dispatch.ts
// Dispatch ideate research to Codex CLI running inside the sandbox container.
//
// The conversational parts (intent gate, reusability question) stay in the
// agentic loop. This module handles the compute-heavy research: searching
// the codebase, reading patterns, and drafting the design document.
//
// Flow:
// 1. Portal collects feature description + user answers from conversation
// 2. This module dispatches to Codex CLI with a research prompt
// 3. Codex searches /workspace, reads files, outputs a JSON design doc
// 4. Portal parses the result and saves it via saveBuildEvidence

import { getDecryptedCredential } from "@/lib/inference/ai-provider-internals";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const IDEATE_TIMEOUT_MS = 300_000; // 5 minutes — research is usually fast

export type IdeateResult = {
  designDoc: Record<string, unknown> | null;
  rawOutput: string;
  success: boolean;
  durationMs: number;
  error?: string;
};

/**
 * Inject Codex CLI auth into the sandbox container.
 * Reuses the same logic as codex-dispatch.ts.
 */
async function ensureCodexAuth(providerId: string): Promise<void> {
  const credential = await getDecryptedCredential(providerId);
  if (!credential?.cachedToken) {
    throw new Error(`No OAuth token for provider "${providerId}".`);
  }

  const accessToken = credential.cachedToken;
  const isJwt = accessToken.split(".").length === 3;
  const idToken = isJwt
    ? accessToken
    : Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")
      + "." + Buffer.from('{"sub":"dpf"}').toString("base64url")
      + ".";

  const authJson = JSON.stringify({
    auth_mode: "chatgptAuthTokens",
    tokens: {
      access_token: accessToken,
      refresh_token: credential.refreshToken ?? "",
      id_token: idToken,
      account_id: null,
    },
    last_refresh: new Date().toISOString(),
  });

  const { exec: execCb } = await import(/* turbopackIgnore: true */ "child_process");
  const { promisify } = await import(/* turbopackIgnore: true */ "util");
  const execAsync = promisify(execCb);

  const authB64 = Buffer.from(authJson).toString("base64");
  await execAsync(
    `docker exec ${SANDBOX_CONTAINER} sh -c "mkdir -p /root/.codex && echo '${authB64}' | base64 -d > /root/.codex/auth.json"`,
    { timeout: 5_000 },
  );
}

/**
 * Inject Claude Code auth into the sandbox container.
 * Supports both OAuth (anthropic-sub) and API key (anthropic) modes.
 */
async function ensureClaudeAuth(providerId: string): Promise<void> {
  const credential = await getDecryptedCredential(providerId);
  const isOAuth = providerId === "anthropic-sub";

  if (!isOAuth) {
    // API key mode — set ANTHROPIC_API_KEY env var
    const apiKey = credential?.secretRef ?? credential?.cachedToken;
    if (!apiKey) {
      throw new Error(`No Anthropic API key for provider "${providerId}".`);
    }
    // Write to a file the sandbox can source
    const { exec: execCb } = await import(/* turbopackIgnore: true */ "child_process");
    const { promisify } = await import(/* turbopackIgnore: true */ "util");
    const execAsync = promisify(execCb);
    const keyB64 = Buffer.from(apiKey).toString("base64");
    await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${keyB64}' | base64 -d > /tmp/.anthropic-key && export ANTHROPIC_API_KEY=\\$(cat /tmp/.anthropic-key)"`,
      { timeout: 5_000 },
    );
    return;
  }

  // OAuth mode — write credentials file
  if (!credential?.cachedToken) {
    throw new Error(`No OAuth token for provider "${providerId}".`);
  }

  const credJson = JSON.stringify({
    oauth_token: credential.cachedToken,
  });

  const { exec: execCb } = await import(/* turbopackIgnore: true */ "child_process");
  const { promisify } = await import(/* turbopackIgnore: true */ "util");
  const execAsync = promisify(execCb);
  const credB64 = Buffer.from(credJson).toString("base64");
  await execAsync(
    `docker exec ${SANDBOX_CONTAINER} sh -c "mkdir -p /root/.claude && echo '${credB64}' | base64 -d > /root/.claude/.credentials.json"`,
    { timeout: 5_000 },
  );
}

/**
 * Build the research prompt for Codex CLI.
 * This is a self-contained prompt — Codex will search the codebase,
 * read files, and output a structured JSON design document.
 */
function buildResearchPrompt(params: {
  featureTitle: string;
  featureDescription: string;
  reusabilityScope: string;
  userContext: string;
  businessContext?: string;
}): string {
  return `You are researching the codebase to design a new feature.

FEATURE: ${params.featureTitle}
DESCRIPTION: ${params.featureDescription}
REUSABILITY: ${params.reusabilityScope}
${params.userContext ? `USER CONTEXT: ${params.userContext}` : ""}
${params.businessContext ? `BUSINESS CONTEXT: ${params.businessContext}` : ""}

YOUR TASK:
1. Search the codebase for existing patterns related to this feature:
   - Search for related keywords in *.prisma files (schema models)
   - Search for related keywords in *.ts files (API routes, components)
   - Read packages/db/prisma/schema.prisma to understand the data model
   - Read at least one existing API route (app/api/*/route.ts) to understand patterns
   - Read at least one existing page component to understand UI patterns

2. Based on what you find, draft a design document.

3. Output ONLY a JSON block (no other text) wrapped in \`\`\`json ... \`\`\` with these fields:
{
  "problemStatement": "What problem this solves and for whom",
  "existingFunctionalityAudit": "Specific files and patterns you found. Reference actual file paths and model names. If nothing related exists, say 'No existing implementation found. Searched for [terms].'",
  "externalResearch": "Best practices for this type of feature based on your knowledge",
  "alternativesConsidered": "Other approaches you considered and why you chose this one",
  "reusePlan": "What existing code/patterns you will reuse",
  "newCodeJustification": "What new code is needed and why",
  "proposedApproach": "Detailed description of how to implement this. Include data model, API routes, UI components, and key interactions.",
  "acceptanceCriteria": ["criterion 1", "criterion 2", "..."],
  "reusabilityAnalysis": {
    "scope": "${params.reusabilityScope}",
    "domainEntities": [{"hardcodedValue": "example", "parameterName": "exampleParam", "otherInstances": ["other1"]}],
    "abstractionBoundary": "What is structural vs what is configurable",
    "contributionReadiness": "high | medium | low"
  }
}

RULES:
- Search thoroughly before writing. Your audit must reference real files.
- If reusability scope is "parameterizable", the proposedApproach MUST describe how domain-specific values are stored as configuration, not hardcoded.
- Output ONLY the JSON block. No commentary, no explanations.`;
}

/**
 * Parse the design doc JSON from Codex CLI output.
 * Handles markdown code blocks and bare JSON.
 */
function parseDesignDoc(output: string): Record<string, unknown> | null {
  // Try markdown code block first
  const codeBlockMatch = output.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]!.trim());
    } catch { /* fall through */ }
  }

  // Try bare JSON (find first { to last })
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(output.slice(firstBrace, lastBrace + 1));
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Dispatch ideate research to Codex CLI inside the sandbox.
 */
export async function dispatchIdeateResearch(params: {
  featureTitle: string;
  featureDescription: string;
  reusabilityScope: string;
  userContext: string;
  businessContext?: string;
  providerId?: string;
  model?: string;
  dispatchEngine?: "claude" | "codex" | "agentic";
}): Promise<IdeateResult> {
  const dispatchEngine = params.dispatchEngine ?? "codex";
  const providerId = params.providerId || "";
  const model = params.model ?? "";

  // Auth
  if (!providerId) {
    return {
      designDoc: null,
      rawOutput: "",
      success: false,
      durationMs: 0,
      error: `No provider configured for ${dispatchEngine} dispatch. Configure via Admin > AI Workforce > External Services.`,
    };
  }

  try {
    if (dispatchEngine === "claude") {
      await ensureClaudeAuth(providerId);
    } else {
      await ensureCodexAuth(providerId);
    }
  } catch (err) {
    return {
      designDoc: null,
      rawOutput: "",
      success: false,
      durationMs: 0,
      error: `Auth error: ${(err as Error).message}`,
    };
  }

  const prompt = buildResearchPrompt(params);
  const startMs = Date.now();

  try {
    const { exec: execCb } = await import(/* turbopackIgnore: true */ "child_process");
    const { promisify } = await import(/* turbopackIgnore: true */ "util");
    const execAsync = promisify(execCb);

    // Write prompt to temp file
    const promptB64 = Buffer.from(prompt).toString("base64");
    await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${promptB64}' | base64 -d > /tmp/ideate-prompt.txt"`,
      { timeout: 5_000 },
    );

    const engineLabel = dispatchEngine === "claude" ? "Claude Code" : "Codex";
    console.log(`[ideate-dispatch] Starting research for "${params.featureTitle}" with ${engineLabel} (${model || "default model"})`);

    // Build the CLI command based on the dispatch engine
    let cliCommand: string;
    if (dispatchEngine === "claude") {
      const modelFlag = model ? `--model ${model}` : "";
      cliCommand = `claude -p "${promptB64}" --output-format text ${modelFlag} 2>/dev/null`;
    } else {
      const modelFlag = model ? `-m ${model}` : "";
      cliCommand = `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ${modelFlag} < /tmp/ideate-prompt.txt 2>/dev/null`;
    }

    const { stdout } = await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "cd /workspace && ${cliCommand}"`,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: IDEATE_TIMEOUT_MS,
      },
    );

    const durationMs = Date.now() - startMs;
    const rawOutput = stdout.trim();

    console.log(`[ideate-dispatch] Research completed in ${(durationMs / 1000).toFixed(1)}s (${rawOutput.length} chars)`);

    const designDoc = parseDesignDoc(rawOutput);
    if (!designDoc) {
      console.warn(`[ideate-dispatch] Could not parse design doc JSON from output. First 500 chars: ${rawOutput.slice(0, 500)}`);
      return {
        designDoc: null,
        rawOutput,
        success: false,
        durationMs,
        error: "Could not parse design document from Codex output.",
      };
    }

    return { designDoc, rawOutput, success: true, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const execErr = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };

    if (execErr.killed) {
      return {
        designDoc: null,
        rawOutput: execErr.stdout ?? "",
        success: false,
        durationMs,
        error: `Research timed out after ${IDEATE_TIMEOUT_MS / 1000}s.`,
      };
    }

    // Codex may exit non-zero but still produce useful output
    if (execErr.stdout?.trim()) {
      const designDoc = parseDesignDoc(execErr.stdout);
      if (designDoc) {
        return { designDoc, rawOutput: execErr.stdout.trim(), success: true, durationMs };
      }
    }

    return {
      designDoc: null,
      rawOutput: execErr.stdout ?? "",
      success: false,
      durationMs,
      error: `Codex CLI error: ${execErr.message?.slice(0, 500) ?? "Unknown"}`,
    };
  }
}
