// apps/web/lib/integrate/ideate-dispatch.ts
// Dispatch ideate research to external CLI (Claude, Codex, or Grok) running inside the sandbox container.
//
// The conversational parts (intent gate, reusability question) stay in the
// agentic loop. This module handles the compute-heavy research: searching
// the codebase, reading patterns, and drafting the design document.
//
// Flow:
// 1. Portal collects feature description + user answers from conversation
// 2. This module dispatches to the configured external CLI with a research prompt
// 3. The CLI searches /workspace, reads files, outputs a design doc
// 4. Portal parses the result and saves it via saveBuildEvidence

import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import {
  SANDBOX_CONTAINER,
  runSandboxAgentCli,
  sandboxExec,
  writeSandboxFile,
} from "./sandbox/agent-cli-runtime";
import type { ChatMessage } from "@/lib/inference/ai-inference";
const IDEATE_TIMEOUT_MS = 600_000; // 10 minutes — complex features need time for codebase research

// Local models often wrap the design JSON in prose or emit malformed JSON that
// survives repairJson. Rather than hard-fail on the first unparseable turn
// (BI-0463ED78), we give the model a bounded chance to reformat its own output
// into strict JSON before surfacing an error to the operator.
export const LOCAL_IDEATE_MAX_ATTEMPTS = 2;
const REFORMAT_INSTRUCTION =
  "Your previous response could not be parsed. Reply with ONLY the design document as a single valid JSON object — no prose, no explanation, and no markdown code fences. Make sure every string is properly quoted and escaped, and remove any trailing commas.";

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

  await writeSandboxFile({
    containerId: SANDBOX_CONTAINER,
    path: "/root/.codex/auth.json",
    content: authJson,
    mkdirParents: "/root/.codex",
  });
}

/**
 * Grok (xAI) specific auth injection for the sandbox.
 *
 * Grok CLI typically authenticates via the XAI_API_KEY environment variable.
 * This is simpler than Codex's auth.json or Claude's dual-mode setup.
 */
async function ensureGrokAuth(providerId: string): Promise<void> {
  const credential = await getDecryptedCredential(providerId);
  const apiKey = credential?.secretRef ?? credential?.cachedToken;

  if (!apiKey) {
    throw new Error(`No xAI API key for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
  }

  // Write the key to a temp file and export it in the runner script.
  // This avoids exposing it in process lists.
  await writeSandboxFile({
    containerId: SANDBOX_CONTAINER,
    path: `/tmp/grok-key-${providerId}.txt`,
    content: apiKey,
    mode: "600",
  });
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

  if (auth.mode === "oauth") {
    // OAuth: write token to temp file, read at exec time via $(cat ...)
    // CLAUDE_CODE_OAUTH_TOKEN takes the raw access token string
    await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: "/tmp/claude-oauth-token.txt", content: auth.token, mode: "644" });
    return {
      authEnvFragment: "CLAUDE_CODE_OAUTH_TOKEN=\\$(cat /tmp/claude-oauth-token.txt)",
      bareFlag: "",  // --bare disables OAuth
    };
  } else {
    // API key: write to temp file
    await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: "/tmp/claude-api-key.txt", content: auth.apiKey, mode: "644" });
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
 *
 * Exported for unit testing the defensive guards on `scoutFindings.*` —
 * the type declares those arrays as required, but `scoutFindings` comes
 * back from JSON the scout produced, and a hallucinated or partial
 * response can leave `relatedModels` or `gaps` undefined. Without guards
 * the first BS dispatch on a fresh build crashes the agent send path
 * with "Cannot read properties of undefined (reading 'map')".
 */
export function buildResearchPrompt(params: {
  featureTitle: string;
  featureDescription: string;
  reusabilityScope: string;
  userContext: string;
  businessContext?: string;
  scoutFindings?: { relatedModels: Array<{ name: string; file: string; line: number }>; gaps: Array<{ entity: string; reason: string }>; externalStructure?: Record<string, unknown>; suggestedQuestions: string[] };
}): string {
  return `You are researching the codebase to design a new feature.

FEATURE: ${params.featureTitle}
DESCRIPTION: ${params.featureDescription}
REUSABILITY: ${params.reusabilityScope}
${params.userContext ? `USER CONTEXT: ${params.userContext}` : ""}
${params.businessContext ? `BUSINESS CONTEXT: ${params.businessContext}` : ""}
${
  params.scoutFindings
    ? `SCOUT FINDINGS (pre-validated — trust these):
Related models found: ${(Array.isArray(params.scoutFindings.relatedModels) ? params.scoutFindings.relatedModels : []).map((m) => `${m.name} at ${m.file}:${m.line}`).join(", ") || "(none reported)"}
Gaps identified: ${(Array.isArray(params.scoutFindings.gaps) ? params.scoutFindings.gaps : []).map((g) => `${g.entity} — ${g.reason}`).join("; ") || "(none reported)"}
${params.scoutFindings.externalStructure ? `External URL structure identified` : ""}

Use these as the basis for your existingFunctionalityAudit. The related models above are confirmed to exist — cite them with file and line numbers.`
    : ""
}

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

  "dataModel": "Describe the data model in PLAIN ENGLISH with a structured layout. For each model: name, purpose (one sentence), then list its fields as: fieldName (Type) — description. Use line breaks between models. Example format:\\n\\nCertificationAuthority — Represents an external certification provider.\\n- slug (String, unique) — short identifier, e.g. 'open-group'\\n- displayName (String) — human-readable name\\n- apiBaseUrl (String) — API endpoint for this provider\\n\\nDo NOT use Prisma syntax or code blocks. Do NOT omit fields. List every field with its type and purpose.\\n\\nIf this feature truly requires NO data model change (e.g. a UI-only tweak on existing data), you MUST still evaluate by confirming what existing models will be used, then write exactly: 'Not applicable — <one-sentence reason, naming the existing models being relied on>'. Never leave empty and never skip the evaluation step.",

  "existingFunctionalityAudit": "REQUIRED — never leave empty. What existing files, models, and patterns you found in the codebase that this feature will build on. Reference specific file paths (apps/web/...) and model names. If nothing related exists, write: 'No existing implementation found. Searched for [list the exact terms you searched for]. This is a new feature.' That format is accepted — but an empty string is not.",

  "proposedApproach": "A clear, readable description of how this will work. Structure it with labeled sections:\\n- Data Model: summarize the models (detail is in the dataModel field)\\n- API Routes: what endpoints, what each does, auth requirements\\n- UI Pages: what pages, what they show, what actions they support\\n- Integration Flow: step-by-step of what happens when the feature is triggered (automatic and manual paths)\\n- Configuration: how admins set up and manage the feature\\nWrite each section so a developer can implement from it without ambiguity.",

  "reusePlan": "What existing code, patterns, and utilities from the codebase will be reused. Be specific — name files and functions. If this feature genuinely cannot reuse existing code (truly novel surface), write exactly: 'Not applicable — <one-sentence reason>'. Only use this when you have searched and confirmed nothing reusable exists.",

  "acceptanceCriteria": ["criterion 1 — written as a testable statement. EVERY explicit requirement in the FEATURE / DESCRIPTION / USER CONTEXT above must appear as its own criterion, preserved faithfully: if the user specified an exact format, example, or behavior (e.g. a RELATIVE timestamp like '3m ago'), the criterion states that exact requirement — never substitute your own design choice (e.g. an absolute 'Updated Jun 15' format) for something the user explicitly asked for.", "criterion 2", "..."],

  "targetRoles": ["who will use this feature — e.g. operations lead, customer. IMPORTANT: if this is an INTERNAL platform/meta-feature (a change to Build Studio, the portal, admin/ops tooling, or the platform itself rather than the org's product for its customers), use internal operator roles like 'platform operator' or 'admin' — never 'customer'. The org's business context does not apply to internal tooling."],

  "accessibility": "REQUIRED for any feature with UI changes. Explicit, testable accessibility requirements: semantic HTML structure, keyboard-operable interactions (tab order, focus states, Enter/Escape handlers), ARIA labels and live regions for non-text affordances, color-is-not-the-sole-conveyor-of-meaning, visible focus indicators. If the feature has NO user-facing UI at all (pure backend / API-only / cron / utility), write exactly: 'Not applicable — <one-sentence reason, e.g. backend-only, no UI surface>'. The review rejects UI features that omit accessibility; this field is how you demonstrate you considered it.",

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
- PRESERVE EXPLICIT USER REQUIREMENTS: anything the user explicitly specified (formats, examples, exact behaviors) is a hard constraint. Carry it verbatim into acceptanceCriteria and the proposedApproach. Never quietly replace a user-specified choice with your own.
- If reusability scope is "parameterizable", the proposedApproach MUST describe how domain-specific values are stored as configuration, not hardcoded.
- "Not applicable" convention: you MUST still evaluate every section. For sections that genuinely do not apply to this feature after evaluation (e.g. a UI-only fix has no data model change, a standalone utility has no reuse target), write the section value as exactly: "Not applicable — <one-sentence reason>". The reviewer accepts this format. Never use it to skip work — only when evaluation concluded the section legitimately does not apply.
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
 * Run the local (routeAndCall) ideate inference with a bounded reformat-retry.
 * On the first attempt the model gets the research prompt; if the output can't
 * be parsed into a design doc, subsequent attempts feed the model its own
 * output back with a strict "JSON only" instruction. This turns a single
 * malformed local inference from a hard failure into a recoverable one
 * (BI-0463ED78) without any provider fallback or new inference path.
 *
 * `call` is injected (rather than importing routeAndCall directly) so the retry
 * loop is unit-testable without the routing stack.
 */
export async function runLocalIdeateWithRetry(
  call: (messages: ChatMessage[]) => Promise<string>,
  basePrompt: string,
  maxAttempts: number = LOCAL_IDEATE_MAX_ATTEMPTS,
  onAttempt?: (attempt: number) => void,
): Promise<{ designDoc: Record<string, unknown> | null; rawOutput: string; attempts: number }> {
  let rawOutput = "";
  let designDoc: Record<string, unknown> | null = null;
  let attempt = 0;
  for (attempt = 1; attempt <= maxAttempts && !designDoc; attempt++) {
    onAttempt?.(attempt);
    const messages: ChatMessage[] =
      attempt === 1
        ? [{ role: "user", content: basePrompt }]
        : [
            { role: "user", content: basePrompt },
            { role: "assistant", content: rawOutput || "(empty response)" },
            { role: "user", content: REFORMAT_INSTRUCTION },
          ];
    rawOutput = (await call(messages)).trim();
    designDoc = parseDesignDoc(rawOutput);
  }
  return { designDoc, rawOutput, attempts: attempt - 1 };
}

/**
 * Dispatch ideate research to the selected external CLI (Claude / Codex / Grok) inside the sandbox.
 */
/** Derive a few distinctive search terms from the feature title + description,
 *  splitting camelCase and dropping boilerplate stopwords. */
export function deriveSearchTerms(title: string, description: string): string[] {
  const STOP = new Set([
    "add","with","unit","test","tests","the","and","for","into","that","this","from",
    "helper","function","functions","value","values","new","build","studio","apps","web",
    "lib","shared","existing","module","modules","return","returns","length","place",
    "search","codebase","first","rather","than","creating","duplicate","only","create",
    "file","files","cover","covering","acceptance","pure","string","stateless","reuse",
  ]);
  const normalized = `${title} ${description}`
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // split camelCase: truncateMiddle → truncate Middle
    .toLowerCase();
  const words = normalized.match(/[a-z][a-z0-9]{2,}/g) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const w of words) {
    if (STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    terms.push(w);
    if (terms.length >= 6) break;
  }
  return terms;
}

/**
 * Real codebase research for the LOCAL (routeAndCall) ideate path. The frontier
 * path searches /workspace via its in-sandbox CLI; locally we query the indexed
 * code graph (searchCodeGraph) for each derived term and format the hits so the
 * model grounds existingFunctionalityAudit on real symbols/paths instead of
 * fabricating the search. Resilient: any failure or an unbuilt graph yields "".
 */
async function gatherCodeGraphContext(
  terms: string[],
  onProgress?: (message: string) => void,
): Promise<string> {
  if (terms.length === 0) return "";
  try {
    const { searchCodeGraph } = await import("@/lib/integrate/code-graph/graph-queries");
    const blocks: string[] = [];
    let anyAvailable = false;
    for (const term of terms) {
      const r = await searchCodeGraph({ query: term, limit: 6 });
      if (!r.available) continue;
      anyAvailable = true;
      if (r.results.length > 0) {
        const hits = r.results
          .map((x) => `  - ${x.name} (${x.path}${x.startLine ? `:${x.startLine}` : ""})`)
          .join("\n");
        blocks.push(`Search "${term}" → ${r.results.length} hit(s):\n${hits}`);
      }
    }
    if (!anyAvailable) return "";
    onProgress?.(`Code graph searched: ${terms.join(", ")}`);
    if (blocks.length === 0) {
      return `\n\nCODE GRAPH SEARCH (authoritative — the indexed codebase was searched for you):\nNo indexed symbol or file matched the feature's key terms: ${terms.join(", ")}. For existingFunctionalityAudit, state that you searched these exact terms in the code graph and found no pre-existing implementation — do NOT invent file paths.`;
    }
    return `\n\nCODE GRAPH SEARCH RESULTS (authoritative — the indexed codebase was searched for you; ground existingFunctionalityAudit and reusePlan on THESE real symbols/paths, do not invent paths):\n${blocks.join("\n")}\n\nIf none of the above is genuinely related, say so explicitly and treat the feature as new.`;
  } catch {
    return "";
  }
}

export async function dispatchIdeateResearch(params: {
  featureTitle: string;
  featureDescription: string;
  reusabilityScope: string;
  userContext: string;
  businessContext?: string;
  scoutFindings?: { relatedModels: Array<{ name: string; file: string; line: number }>; gaps: Array<{ entity: string; reason: string }>; externalStructure?: Record<string, unknown>; suggestedQuestions: string[] };
  providerId?: string;
  model?: string;
  dispatchEngine?: "claude" | "codex" | "grok" | "opencode" | "agentic";
  /** EP-MODEL-TIER-ROUTING: capability tier for the local routeAndCall ideate
   *  path. "robust" lets routing prefer a frontier endpoint for large designs;
   *  "local"/undefined keeps it on the on-box model. */
  modelTier?: "local" | "robust";
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
  onProgress?: (message: string) => void;
}): Promise<IdeateResult> {
  const dispatchEngine = params.dispatchEngine ?? "codex";
  const providerId = params.providerId || "";
  const model = params.model ?? "";

  // Routed engines (local OpenCode or the supported agentic fallback): Ideate
  // research runs through portal-side
  // routing — the SAME routeAndCall path the Plan phase uses — not a vendor CLI.
  // The configured local model (e.g. qwen3-coder via Docker Model Runner)
  // generates the design doc with no credential and no egress. This is the last
  // piece that lets the full Build Studio pipeline (ideate → plan → build) run
  // end-to-end off a local LLM: Plan already uses routeAndCall, Build dispatches
  // to the opencode runner, and now Ideate uses routing too instead of falling
  // through to the `codex exec` branch below. (BI-01D6A51B)
  if (dispatchEngine === "opencode" || dispatchEngine === "agentic") {
    const startMs = Date.now();
    try {
      // The frontier ideate path dispatches a CLI into the sandbox that actually
      // searches /workspace. The local routeAndCall path can't — so without help
      // the model FABRICATES the "existingFunctionalityAudit" ("Searched for …")
      // per the prompt template without searching anything. Wire the real code
      // graph in: pre-fetch indexed symbols/files for the feature's terms and
      // inject them as authoritative search results the model must ground on.
      const codeGraphContext = await gatherCodeGraphContext(
        deriveSearchTerms(params.featureTitle, params.featureDescription),
        params.onProgress,
      );
      const basePrompt = buildResearchPrompt(params) + codeGraphContext;
      const { routeAndCall } = await import("@/lib/inference/routed-inference");
      const systemPrompt =
        "You are a senior software architect producing a structured design document. Respond with the design document content only — no preamble.";
      const { designDoc, rawOutput } = await runLocalIdeateWithRetry(
        async (messages) => {
          const response = await routeAndCall(messages, systemPrompt, params.sensitivity ?? "internal", {
            budgetClass: "quality_first",
            ...(providerId ? { allowedProviders: [providerId] } : {}),
            ...(params.modelTier ? { modelTier: params.modelTier } : {}),
          });
          return response.content ?? "";
        },
        basePrompt,
        LOCAL_IDEATE_MAX_ATTEMPTS,
        (attempt) => {
          if (attempt > 1) params.onProgress?.("Reformatting the design into valid JSON…");
        },
      );
      return {
        designDoc,
        rawOutput,
        success: !!designDoc,
        durationMs: Date.now() - startMs,
        error: designDoc
          ? undefined
          : "Routed ideate output could not be parsed into a design document.",
      };
    } catch (err) {
      return {
        designDoc: null,
        rawOutput: "",
        success: false,
        durationMs: Date.now() - startMs,
        error: `Routed ideate failed: ${(err as Error).message}`,
      };
    }
  }

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
    } else if (dispatchEngine === "grok") {
      await ensureGrokAuth(providerId);
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
    // Write prompt to temp file
    await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: "/tmp/ideate-prompt.txt", content: prompt });

    const engineLabel =
      dispatchEngine === "claude" ? "Claude Code" : dispatchEngine === "grok" ? "Grok" : "Codex";
    console.log(`[ideate-dispatch] Starting research for "${params.featureTitle}" with ${engineLabel} (${model || "default model"})`);

    // Build the CLI command based on the dispatch engine, written to a shared
    // sandbox runner script (avoids quoting issues with nested $() in docker exec
    // sh -c). `runAsNode` mirrors the main dispatchers: claude + grok run as the
    // node user (after their auth temp files are written); codex runs as root via
    // its auth.json injection.
    const runnerScript = "/tmp/ideate-run.sh";
    let runAsNode: boolean;
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
      await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: runnerScript, content: script, mode: "755" });
      runAsNode = true;
    } else if (dispatchEngine === "grok") {
      // Grok (xAI) specific path for Ideate research dispatch (distinct from the full
      // specialist task dispatch in grok-dispatch.ts used by Build Studio orchestrator).
      //
      // Unique aspects (parity maintained with main dispatch):
      // - Auth: Simple XAI_API_KEY env var (no auth.json or OAuth refresh like Claude/Codex).
      // - Invocation: the SAME headless form grok-dispatch.ts proved against grok
      //   0.2.32 — `--prompt-file <file> --always-approve`. The old
      //   `-p - --no-auto-update < file` form passed "-" as the literal prompt and
      //   ignored the file (and `--no-auto-update` is not a valid flag), so this
      //   ideate path never actually ran — a latent failure now fixed. (BI-OPT-DISPATCH)
      // - Strengths: Real-time knowledge for research-oriented Ideate flows.
      const modelFlag = model ? `--model ${model}` : "";
      const script = [
        "#!/bin/sh",
        `cd /workspace`,
        `export XAI_API_KEY=$(cat /tmp/grok-key-${providerId}.txt 2>/dev/null || echo '')`,
        `grok ${modelFlag} --prompt-file /tmp/ideate-prompt.txt --always-approve`,
      ].join("\n");
      await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: runnerScript, content: script, mode: "755" });
      runAsNode = true;
    } else {
      const modelFlag = model ? `-m ${model}` : "";
      const script = [
        "#!/bin/sh",
        `cd /workspace`,
        `exec codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ${modelFlag} < /tmp/ideate-prompt.txt 2>/dev/null`,
      ].join("\n");
      await writeSandboxFile({ containerId: SANDBOX_CONTAINER, path: runnerScript, content: script, mode: "755" });
      runAsNode = false;
    }

    // Shared spawn-docker-exec loop (streams stderr for progress, matching the
    // main dispatchers). Resolves on close when exit==0 OR stdout is non-empty.
    const { stdout: spawnStdout, durationMs: elapsed } = await runSandboxAgentCli({
      containerId: SANDBOX_CONTAINER,
      runnerScript,
      timeoutMs: IDEATE_TIMEOUT_MS,
      asNodeUser: runAsNode,
      onStderrLine: (line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("Compiling")) return;

          if (dispatchEngine === "claude") {
            // Claude-specific progress patterns
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
          } else if (dispatchEngine === "grok") {
            // Grok-specific progress patterns (Grok CLI often uses different phrasing)
            if (trimmed.toLowerCase().includes("reading") || trimmed.toLowerCase().includes("analyzing file")) {
              params.onProgress?.(trimmed);
            } else if (trimmed.toLowerCase().includes("thinking") || trimmed.toLowerCase().includes("searching")) {
              params.onProgress?.(trimmed);
            } else {
              console.log(`[ideate-dispatch] grok progress: ${trimmed.slice(0, 120)}`);
            }
          } else {
            // Codex / default
            console.log(`[ideate-dispatch] progress: ${trimmed.slice(0, 120)}`);
          }
      },
    });

    const durationMs = elapsed;
    let rawOutput = spawnStdout.trim();

    // If using --output-format json, extract the result field (Claude-specific today)
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

    // Recovery: when the process exited non-zero with EMPTY stdout (e.g. Claude
    // killed mid-run), recover the tee'd output from /tmp/ideate-output.json —
    // the claude runner script tees its stdout there. Preserves the original
    // close-handler recovery now that the shared runner rejects this case.
    if (!execErr.stdout?.trim()) {
      try {
        const recovered = (await sandboxExec()(
          `docker exec ${SANDBOX_CONTAINER} cat /tmp/ideate-output.json 2>/dev/null`,
          { timeout: 5_000 },
        )).stdout.trim();
        if (recovered) {
          console.log(`[ideate-dispatch] Recovered ${recovered.length} chars from file`);
          let recoveredOut = recovered;
          if (dispatchEngine === "claude" && recoveredOut.startsWith("{")) {
            try {
              const parsed = JSON.parse(recoveredOut);
              if (parsed.result) {
                recoveredOut = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
              }
            } catch { /* use as-is */ }
          }
          const designDoc = parseDesignDoc(recoveredOut);
          if (designDoc) {
            return { designDoc, rawOutput: recoveredOut, success: true, durationMs };
          }
        }
      } catch { /* no file */ }
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
