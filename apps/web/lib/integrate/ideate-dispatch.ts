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

type ClaudeAuth =
  | { mode: "oauth"; token: string }
  | { mode: "apikey"; apiKey: string };

/**
 * Resolve Claude auth credentials from the DB.
 * Mirrors the pattern in claude-dispatch.ts.
 */
async function resolveClaudeAuth(providerId: string): Promise<ClaudeAuth> {
  const credential = await getDecryptedCredential(providerId);
  const isOAuth = providerId === "anthropic-sub";

  if (!isOAuth) {
    const apiKey = credential?.secretRef ?? credential?.cachedToken;
    if (!apiKey) {
      throw new Error(`No Anthropic API key for provider "${providerId}".`);
    }
    return { mode: "apikey", apiKey };
  }

  if (!credential?.cachedToken) {
    throw new Error(`No OAuth token for provider "${providerId}".`);
  }
  return { mode: "oauth", token: credential.cachedToken };
}

/**
 * Write Claude auth to temp files in the sandbox so they can be read
 * as env vars at exec time. Returns the env var fragment for the CLI command.
 */
async function ensureClaudeAuth(providerId: string): Promise<{ authEnvFragment: string; bareFlag: string }> {
  const auth = await resolveClaudeAuth(providerId);

  const { exec: execCb } = await import(/* turbopackIgnore: true */ "child_process");
  const { promisify } = await import(/* turbopackIgnore: true */ "util");
  const execAsync = promisify(execCb);

  if (auth.mode === "oauth") {
    // OAuth: write token to temp file, read at exec time via $(cat ...)
    // CLAUDE_CODE_OAUTH_TOKEN takes the raw access token string
    const tokenB64 = Buffer.from(auth.token).toString("base64");
    await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${tokenB64}' | base64 -d > /tmp/claude-oauth-token.txt && chmod 644 /tmp/claude-oauth-token.txt"`,
      { timeout: 5_000 },
    );
    return {
      authEnvFragment: "CLAUDE_CODE_OAUTH_TOKEN=\\$(cat /tmp/claude-oauth-token.txt)",
      bareFlag: "",  // --bare disables OAuth
    };
  } else {
    // API key: write to temp file
    const keyB64 = Buffer.from(auth.apiKey).toString("base64");
    await execAsync(
      `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${keyB64}' | base64 -d > /tmp/claude-api-key.txt && chmod 644 /tmp/claude-api-key.txt"`,
      { timeout: 5_000 },
    );
    return {
      authEnvFragment: "ANTHROPIC_API_KEY=\\$(cat /tmp/claude-api-key.txt)",
      bareFlag: "--bare ",
    };
  }
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

2. Based on what you find, draft a design specification document.

3. Output ONLY a JSON block (no other text) wrapped in \`\`\`json ... \`\`\` with these fields.
   CRITICAL: The values must be written in HUMAN-READABLE prose, not code or machine format.
   Imagine a product manager and a developer both reading this document — it should be
   clear, specific, and readable without needing to parse JSON structures or code blocks.

{
  "problemStatement": "What problem this solves, who it affects, and why it matters. Write 2-3 sentences a non-technical stakeholder can understand.",

  "dataModel": "Describe the data model in PLAIN ENGLISH with a structured layout. For each model: name, purpose (one sentence), then list its fields as: fieldName (Type) — description. Use line breaks between models. Example format:\\n\\nCertificationAuthority — Represents an external certification provider.\\n- slug (String, unique) — short identifier, e.g. 'open-group'\\n- displayName (String) — human-readable name\\n- apiBaseUrl (String) — API endpoint for this provider\\n\\nDo NOT use Prisma syntax or code blocks. Do NOT omit fields. List every field with its type and purpose.",

  "existingCodeAudit": "What existing files, models, and patterns you found in the codebase that this feature will build on. Reference specific file paths (apps/web/...) and model names. If nothing related exists, say so and list what you searched for.",

  "proposedApproach": "A clear, readable description of how this will work. Structure it with labeled sections:\\n- Data Model: summarize the models (detail is in the dataModel field)\\n- API Routes: what endpoints, what each does, auth requirements\\n- UI Pages: what pages, what they show, what actions they support\\n- Integration Flow: step-by-step of what happens when the feature is triggered (automatic and manual paths)\\n- Configuration: how admins set up and manage the feature\\nWrite each section so a developer can implement from it without ambiguity.",

  "reusePlan": "What existing code, patterns, and utilities from the codebase will be reused. Be specific — name files and functions.",

  "acceptanceCriteria": ["criterion 1 — written as a testable statement", "criterion 2", "..."],

  "reusabilityAnalysis": {
    "scope": "${params.reusabilityScope}",
    "domainEntities": [{"hardcodedValue": "example", "parameterName": "exampleParam", "otherInstances": ["other1"]}],
    "abstractionBoundary": "What is structural (same for all instances) vs what is configurable (varies per instance)",
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

  // Resolve auth — returns env var fragments for Claude, or injects auth file for Codex
  let claudeAuthEnv = "";
  let claudeBareFlag = "";
  try {
    if (dispatchEngine === "claude") {
      const authResult = await ensureClaudeAuth(providerId);
      claudeAuthEnv = authResult.authEnvFragment;
      claudeBareFlag = authResult.bareFlag;
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

    // Build the CLI command based on the dispatch engine.
    // Both engines read from /tmp/ideate-prompt.txt which was already written above.
    // Claude runs as --user node (refuses root). Codex runs as root.
    // IMPORTANT: Use single quotes for sh -c '...' so $(cat ...) expands inside
    // the sandbox shell, not the host shell.
    let fullCommand: string;
    if (dispatchEngine === "claude") {
      const modelFlag = model ? `--model ${model}` : "";
      // Matches claude-dispatch.ts spawn pattern:
      // - Env var for auth (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)
      // - --dangerously-skip-permissions for sandbox
      // - Read prompt from stdin via < /tmp/ideate-prompt.txt
      // - --output-format json to get structured output we can parse
      fullCommand = `docker exec --user node ${SANDBOX_CONTAINER} sh -c 'cd /workspace && ${claudeAuthEnv} claude ${claudeBareFlag}-p - --dangerously-skip-permissions --output-format json ${modelFlag} < /tmp/ideate-prompt.txt'`;
    } else {
      const modelFlag = model ? `-m ${model}` : "";
      fullCommand = `docker exec ${SANDBOX_CONTAINER} sh -c 'cd /workspace && codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ${modelFlag} < /tmp/ideate-prompt.txt 2>/dev/null'`;
    }

    const { stdout } = await execAsync(
      fullCommand,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: IDEATE_TIMEOUT_MS,
      },
    );

    const durationMs = Date.now() - startMs;
    let rawOutput = stdout.trim();

    // If using --output-format json, extract the result field
    if (dispatchEngine === "claude" && rawOutput.startsWith("{")) {
      try {
        const parsed = JSON.parse(rawOutput);
        if (parsed.result) {
          rawOutput = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
          console.log(`[ideate-dispatch] Extracted result from JSON output (${rawOutput.length} chars, is_error=${parsed.is_error})`);
        }
      } catch {
        // Not valid JSON — use raw output as-is
      }
    }

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
