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

import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const IDEATE_TIMEOUT_MS = 600_000; // 10 minutes — complex features need time for codebase research

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
 * For OAuth providers, uses getProviderBearerToken so expired tokens are
 * automatically refreshed (access tokens expire every few hours; refresh
 * tokens are valid for days). Falls back to getDecryptedCredential for
 * API key providers where no refresh is needed.
 */
async function resolveClaudeAuth(providerId: string): Promise<ClaudeAuth> {
  const isOAuth = providerId === "anthropic-sub";

  if (!isOAuth) {
    const credential = await getDecryptedCredential(providerId);
    const apiKey = credential?.secretRef ?? credential?.cachedToken;
    if (!apiKey) {
      throw new Error(`No Anthropic API key for provider "${providerId}".`);
    }
    return { mode: "apikey", apiKey };
  }

  // OAuth: use getProviderBearerToken which checks expiry and refreshes automatically.
  // Direct getDecryptedCredential would return an expired access token on the next
  // request after tokenExpiresAt, causing a 401 from the CLI.
  const result = await getProviderBearerToken(providerId);
  if ("error" in result) {
    throw new Error(`OAuth token refresh failed for "${providerId}": ${result.error}. Re-authenticate via Admin > AI Providers > Anthropic Subscription.`);
  }
  return { mode: "oauth", token: result.token };
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

  "existingFunctionalityAudit": "REQUIRED — never leave empty. What existing files, models, and patterns you found in the codebase that this feature will build on. Reference specific file paths (apps/web/...) and model names. If nothing related exists, write: 'No existing implementation found. Searched for [list the exact terms you searched for]. This is a new feature.' That format is accepted — but an empty string is not.",

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
- existingFunctionalityAudit MUST never be empty or null. If you find nothing relevant, write what you searched for.
- If reusability scope is "parameterizable", the proposedApproach MUST describe how domain-specific values are stored as configuration, not hardcoded.
- Output ONLY the JSON block. No commentary, no explanations.
- VALID JSON ONLY: The output must parse with JSON.parse(). Do NOT put double-quote characters inside string values — they break parsing. Version numbers (1.0.0), product names, and file paths must NOT be wrapped in quotes inside a JSON string. WRONG: "assigns version \\"1.0.0\\" to each" — RIGHT: "assigns version 1.0.0 to each". If you need to emphasize something, use parentheses or dashes instead of quotes.`;
}

/**
 * Attempt lightweight JSON repair on AI-generated output before giving up.
 * Handles the two most common Claude JSON errors:
 * 1. Trailing commas before ] or } (always invalid JSON)
 * 2. Unescaped double quotes inside string values (e.g. "version "1.0.0" of")
 *
 * The unescaped-quote repair uses a character-level state machine to distinguish
 * quotes that are part of the JSON structure from quotes that appear inside a
 * string value and need to be escaped.
 */
function repairJson(text: string): string {
  // Pass 1: remove trailing commas
  let s = text.replace(/,(\s*[\]}])/g, "$1");

  // Pass 2: escape unescaped double quotes inside string values.
  // Walk character by character tracking: inString, escaped.
  // When we see a " that is NOT the opening/closing quote of a key or value,
  // replace it with \".
  const chars = Array.from(s);
  let inString = false;
  let escaped = false;
  const out: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out.push(ch);
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        out.push(ch);
      } else {
        // Peek ahead: if next non-whitespace is : , } ] or end-of-string, this closes a value/key
        let j = i + 1;
        while (j < chars.length && chars[j] === " ") j++;
        const next = chars[j] ?? "";
        if (next === ":" || next === "," || next === "}" || next === "]" || next === "\n" || next === "\r" || j >= chars.length) {
          inString = false;
          out.push(ch);
        } else {
          // Mid-string unescaped quote — escape it
          out.push('\\"');
        }
      }
      continue;
    }
    out.push(ch);
  }

  return out.join("");
}

/**
 * Parse the design doc JSON from Codex/Claude CLI output.
 * Tries: markdown code block → bare JSON → repaired code block → repaired bare JSON.
 */
function parseDesignDoc(output: string): Record<string, unknown> | null {
  function tryParse(text: string): Record<string, unknown> | null {
    const t = text.trim();
    try { return JSON.parse(t); } catch { /* try repair */ }
    try { return JSON.parse(repairJson(t)); } catch { return null; }
  }

  // Try markdown code block first (non-greedy — first ```)
  const codeBlockMatch = output.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const result = tryParse(codeBlockMatch[1]!);
    if (result) return result;
  }

  // Try bare JSON (find first { to last })
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const result = tryParse(output.slice(firstBrace, lastBrace + 1));
    if (result) return result;
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
  onProgress?: (message: string) => void;
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
    // Write a shell script to the sandbox to avoid all quoting issues with
    // nested $() in docker exec sh -c.
    let fullCommand: string;
    if (dispatchEngine === "claude") {
      const modelFlag = model ? `--model ${model}` : "";
      // Write a runner script that handles auth env var expansion inside the sandbox.
      // Tee output to a file so we can recover it if the process is killed on timeout.
      const script = [
        "#!/bin/sh",
        `cd /workspace`,
        `export ${claudeAuthEnv.replace(/\\\$/g, "$")}`,
        `claude ${claudeBareFlag}-p - --dangerously-skip-permissions --output-format json ${modelFlag} < /tmp/ideate-prompt.txt | tee /tmp/ideate-output.json`,
      ].join("\n");
      const scriptB64 = Buffer.from(script).toString("base64");
      await execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${scriptB64}' | base64 -d > /tmp/ideate-run.sh && chmod 755 /tmp/ideate-run.sh"`,
        { timeout: 5_000 },
      );
      fullCommand = `docker exec --user node ${SANDBOX_CONTAINER} /tmp/ideate-run.sh`;
    } else {
      const modelFlag = model ? `-m ${model}` : "";
      const script = [
        "#!/bin/sh",
        `cd /workspace`,
        `exec codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ${modelFlag} < /tmp/ideate-prompt.txt 2>/dev/null`,
      ].join("\n");
      const scriptB64 = Buffer.from(script).toString("base64");
      await execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${scriptB64}' | base64 -d > /tmp/ideate-run.sh && chmod 755 /tmp/ideate-run.sh"`,
        { timeout: 5_000 },
      );
      fullCommand = `docker exec ${SANDBOX_CONTAINER} /tmp/ideate-run.sh`;
    }

    // Use spawn (not execAsync) so we can stream stderr progress in real-time,
    // matching the pattern in claude-dispatch.ts.
    const { spawn: spawnCb } = await import(/* turbopackIgnore: true */ "child_process");

    const cmdParts = fullCommand.split(" ");
    const { stdout: spawnStdout, durationMs: elapsed } = await new Promise<{ stdout: string; durationMs: number }>((resolve, reject) => {
      const proc = spawnCb(cmdParts[0], cmdParts.slice(1));
      let stdout = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, IDEATE_TIMEOUT_MS);

      proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("Compiling")) continue;
          // Parse Claude CLI progress and forward to UI
          if (trimmed.startsWith("Reading file:")) {
            params.onProgress?.(`Reading ${trimmed.replace("Reading file: ", "")}`);
          } else if (trimmed.startsWith("Writing file:") || trimmed.startsWith("Creating file:")) {
            params.onProgress?.(`Analyzing ${trimmed.replace(/^(Writing|Creating) file: /, "")}`);
          } else if (trimmed.startsWith("Running bash command:") || trimmed.startsWith("Running command:")) {
            params.onProgress?.(`Searching: ${trimmed.replace(/^Running( bash)? command: /, "").slice(0, 80)}`);
          } else if (trimmed === "Thinking...") {
            params.onProgress?.("Thinking...");
          } else {
            console.log(`[ideate-dispatch] progress: ${trimmed.slice(0, 120)}`);
          }
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        const d = Date.now() - startMs;
        if (timedOut) {
          reject(Object.assign(new Error(`Timed out after ${IDEATE_TIMEOUT_MS / 1000}s`), { stdout, killed: true }));
        } else if (code === 0 || stdout.trim()) {
          resolve({ stdout, durationMs: d });
        } else {
          console.error(`[ideate-dispatch] Exit code ${code}, stdout empty, recovering from file...`);
          // Try to recover output from tee'd file
          const { execSync } = require("child_process");
          try {
            const recovered = execSync(
              `docker exec ${SANDBOX_CONTAINER} cat /tmp/ideate-output.json 2>/dev/null`,
              { timeout: 5_000 },
            ).toString().trim();
            if (recovered) {
              console.log(`[ideate-dispatch] Recovered ${recovered.length} chars from file`);
              resolve({ stdout: recovered, durationMs: d });
              return;
            }
          } catch { /* no file */ }
          reject(Object.assign(new Error(`Exit code ${code}`), { stdout, code }));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const durationMs = elapsed;
    let rawOutput = spawnStdout.trim();

    // If using --output-format json, extract the result field
    if (dispatchEngine === "claude" && rawOutput.startsWith("{")) {
      try {
        const parsed = JSON.parse(rawOutput);
        // Fail fast on CLI-level errors (auth failures, rate limits, etc.)
        // before parseDesignDoc accidentally misidentifies the error JSON as a design doc.
        if (parsed.is_error) {
          const errText = typeof parsed.result === "string" ? parsed.result : "Claude CLI returned an error";
          const isAuth = errText.includes("401") || errText.toLowerCase().includes("authentication") || errText.toLowerCase().includes("invalid.*credentials");
          console.error(`[ideate-dispatch] Claude CLI error (is_error=true): ${errText.slice(0, 200)}`);
          return {
            designDoc: null,
            rawOutput,
            success: false,
            durationMs,
            error: isAuth
              ? "Claude authentication failed (401). The Anthropic OAuth token has expired — go to Admin > AI Providers > Anthropic Subscription and reconnect."
              : `Claude CLI error: ${errText.slice(0, 150)}`,
          };
        }
        if (parsed.result) {
          rawOutput = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
          console.log(`[ideate-dispatch] Extracted result from JSON output (${rawOutput.length} chars)`);
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
        error: "Could not parse design document from research output. The research engine may have returned an unexpected format.",
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
