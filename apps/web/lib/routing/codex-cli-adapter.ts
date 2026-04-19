// apps/web/lib/routing/codex-cli-adapter.ts

/**
 * Codex CLI execution adapter for codex (OpenAI subscription OAuth) users.
 *
 * OAuth subscription tokens are NOT supported via direct HTTP calls to the
 * ChatGPT backend (chatgpt.com/backend-api) — the backend requires session
 * auth that only the Codex CLI binary provides. This adapter routes inference
 * through `codex exec` in the sandbox container, mirroring the pattern used
 * for anthropic-sub → claude-cli adapter.
 *
 * Auth is injected via ~/.codex/auth.json (same as codex-dispatch.ts for
 * build tasks). The Codex CLI handles its own HTTP layer and auth format.
 *
 * For API key auth, the OPENAI_API_KEY env var is used instead.
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler, ToolCallEntry } from "./adapter-types";
import { InferenceError } from "@/lib/ai-inference";
import { getDecryptedCredential, getProviderBearerToken } from "@/lib/inference/ai-provider-internals";
import { registerExecutionAdapter } from "./execution-adapter-registry";
import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const CLI_TIMEOUT_MS = 180_000; // 3 minutes

// ─── Auth injection ────────────────────────────────────────────────────────

/**
 * Inject Codex CLI auth into the sandbox container.
 * Mirrors the auth injection from codex-dispatch.ts:injectCodexAuth.
 *
 * The Codex CLI expects ~/.codex/auth.json with:
 * - auth_mode: "chatgptAuthTokens" (use tokens as-is, no browser refresh)
 * - tokens.access_token: the OAuth access token
 * - tokens.id_token: a JWT (same as access_token if JWT, or synthetic)
 */
async function injectAuth(providerId: string): Promise<{ mode: "oauth" } | { mode: "apikey"; apiKey: string }> {
  const credential = await getDecryptedCredential(providerId);
  if (!credential) {
    throw new InferenceError(
      `No credential for "${providerId}". Configure via Admin > AI Workforce > External Services.`,
      "auth",
      providerId,
    );
  }

  // API key mode — use OPENAI_API_KEY env var
  if (credential.secretRef && !credential.cachedToken) {
    return { mode: "apikey", apiKey: credential.secretRef };
  }

  // OAuth mode — inject auth.json
  // Use getProviderBearerToken which handles token refresh automatically.
  const tokenResult = await getProviderBearerToken(providerId);
  if ("error" in tokenResult) {
    throw new InferenceError(
      `OAuth token error for "${providerId}": ${tokenResult.error}. Re-authenticate via Admin > AI Workforce > External Services.`,
      "auth",
      providerId,
    );
  }

  const accessToken = tokenResult.token;
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

  const execAsync = lazyUtil().promisify(lazyChildProcess().exec);
  const authB64 = Buffer.from(authJson).toString("base64");
  await execAsync(
    `docker exec ${SANDBOX_CONTAINER} sh -c "mkdir -p /root/.codex && echo '${authB64}' | base64 -d > /root/.codex/auth.json"`,
    { timeout: 5_000 },
  );

  return { mode: "oauth" };
}

// ─── Codex CLI adapter ─────────────────────────────────────────────────────

export const codexCliAdapter: ExecutionAdapterHandler = {
  type: "codex-cli",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, messages, systemPrompt, tools } = request;
    const startMs = Date.now();

    // 1. Inject auth
    const auth = await injectAuth(providerId);

    // 2. Build prompt from messages
    const promptParts: string[] = [];
    if (systemPrompt) {
      promptParts.push(systemPrompt);
      promptParts.push("---");
    }
    for (const msg of messages) {
      if (msg.role === "system") continue;
      const content = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);

      if (msg.role === "user") {
        promptParts.push(`Human: ${content}`);
      } else if (msg.role === "assistant") {
        promptParts.push(`Assistant: ${content}`);
      } else if (msg.role === "tool" && msg.toolCallId) {
        promptParts.push(`Tool Result (${msg.toolCallId}): ${content}`);
      }
    }

    // Add tool definitions to prompt context.
    // The format spec is deliberately explicit so the model emits JSON the
    // extractor below can actually parse — the model otherwise invents
    // variants (XML-ish wrappers, {tool, arguments} key shape, markdown
    // code fences) which silently fail tool dispatch and force the agent
    // to "explain" it couldn't find the tool.
    if (tools && tools.length > 0) {
      const toolDescriptions = tools.map((t) => {
        const fn = (t as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } }).function;
        if (fn) {
          return `- ${fn.name}: ${fn.description ?? ""}${fn.parameters ? ` Parameters: ${JSON.stringify(fn.parameters)}` : ""}`;
        }
        return `- ${JSON.stringify(t)}`;
      });
      promptParts.push(
        `\nAvailable tools. To invoke a tool, output ONE JSON object per invocation ` +
        `using exactly this shape:\n` +
        `{"type":"tool_use","id":"<unique_id>","name":"<tool_name>","input":{<args>}}\n` +
        `Do NOT wrap in XML tags, markdown fences, or rename the keys. ` +
        `When invoking a tool, output only the JSON (no surrounding prose).\n\n` +
        `Tools:\n${toolDescriptions.join("\n")}`,
      );
    }

    const prompt = promptParts.join("\n\n");

    // 3. Write prompt to temp file in sandbox
    const slug = `codex-conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const promptFile = `/tmp/${slug}-prompt.txt`;
    const runnerScript = `/tmp/${slug}-run.sh`;

    const cp = lazyChildProcess();
    const execAsync = lazyUtil().promisify(cp.exec);
    const spawnCb = cp.spawn;

    try {
      const promptB64 = Buffer.from(prompt).toString("base64");
      await execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${promptB64}' | base64 -d > ${promptFile} && chmod 644 ${promptFile}"`,
        { timeout: 5_000 },
      );

      // 4. Build runner script
      const modelFlag = modelId ? `-m ${modelId}` : "";
      let authExportLine: string;
      if (auth.mode === "apikey") {
        authExportLine = `export OPENAI_API_KEY=${auth.apiKey}`;
      } else {
        // OAuth mode — auth.json already injected
        authExportLine = "# OAuth auth via ~/.codex/auth.json";
      }

      const script = [
        "#!/bin/sh",
        "cd /workspace",
        authExportLine,
        `exec codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ${modelFlag} < ${promptFile}`,
      ].join("\n");

      const scriptB64 = Buffer.from(script).toString("base64");
      await execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "echo '${scriptB64}' | base64 -d > ${runnerScript} && chmod 755 ${runnerScript}"`,
        { timeout: 5_000 },
      );

      // 5. Spawn the CLI process
      console.log(`[codex-cli-adapter] Dispatching: model=${modelId}, provider=${providerId}, messages=${messages.length}`);

      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        const proc = spawnCb("docker", [
          "exec", SANDBOX_CONTAINER, runnerScript,
        ]);

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, CLI_TIMEOUT_MS);

        proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
        proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

        proc.on("close", (code: number | null) => {
          clearTimeout(timer);
          if (timedOut) {
            reject(new InferenceError(
              `Codex CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`,
              "provider_error",
              providerId,
            ));
          } else if (code === 0 || stdout.trim()) {
            resolve({ stdout });
          } else {
            if (stderr.includes("Not logged in") || stderr.includes("unauthorized") || stderr.includes("401")) {
              reject(new InferenceError(
                `Codex CLI auth failed: ${stderr.slice(0, 300)}`,
                "auth",
                providerId,
              ));
            } else if (stderr.includes("rate") || stderr.includes("429")) {
              reject(new InferenceError(
                `Codex CLI rate limited: ${stderr.slice(0, 300)}`,
                "rate_limit",
                providerId,
              ));
            } else {
              reject(new InferenceError(
                `Codex CLI exit code ${code}: ${stderr.slice(0, 500)}`,
                "provider_error",
                providerId,
              ));
            }
          }
        });

        proc.on("error", (err: Error) => {
          clearTimeout(timer);
          reject(new InferenceError(
            `Codex CLI spawn error: ${err.message}`,
            "network",
            providerId,
          ));
        });
      });

      // 6. Parse output — codex exec returns plain text (no structured JSON)
      const text = stdout.trim();
      const inferenceMs = Date.now() - startMs;

      console.log(
        `[codex-cli-adapter] Completed: ${text.length} chars, ${inferenceMs}ms`,
      );

      // Attempt to extract tool calls if the model responded with tool_use blocks
      const toolCalls = extractToolCalls(text);

      return {
        text: toolCalls.length > 0 ? text.replace(/```json\n?\{[\s\S]*?```/g, "").trim() : text,
        toolCalls,
        usage: { inputTokens: 0, outputTokens: 0 }, // CLI doesn't report usage
        inferenceMs,
      };
    } finally {
      // Clean up temp files (fire-and-forget)
      execAsync(
        `docker exec ${SANDBOX_CONTAINER} sh -c "rm -f ${promptFile} ${runnerScript}"`,
        { timeout: 5_000 },
      ).catch(() => {});
    }
  },
};

/**
 * Extract tool_use blocks from Codex CLI text output.
 *
 * The model emits several shapes in practice, and each variant has to be
 * accepted or the agentic loop silently drops the call and the coworker
 * "explains" that the tool isn't available. Shapes handled:
 *
 *   1. {"type":"tool_use","id":"x","name":"t","input":{...}}   (spec)
 *   2. {"name":"t","input":{...}}                              (missing type/id)
 *   3. {"tool":"t","arguments":{...}}                          (alt key names)
 *   4. <tool_use>{...}</tool_use>                              (XML-ish wrapper)
 *   5. ```json\n{...}\n```                                     (markdown fence)
 *
 * Any recognisable object is normalised to ToolCallEntry. We look for
 * candidate JSON objects inside the entire text (fenced, tagged, or
 * inline) and accept the first valid shape each.
 */
/**
 * Deterministic JSON stringify with sorted object keys — used to build a
 * content-based dedup key for tool calls that the same response expresses
 * in two different wrappers (e.g. XML-ish + inline).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * Returns the index of the `}` that closes the object starting at `openIdx`,
 * or -1 if the object is not well-balanced. Respects JSON string literals so
 * braces inside strings don't throw off the depth counter.
 */
function findBalancedEnd(text: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractToolCalls(text: string): ToolCallEntry[] {
  const toolCalls: ToolCallEntry[] = [];
  const seen = new Set<string>();

  // Strip XML-ish <tool_use>...</tool_use> and markdown ```json ... ``` wrappers
  // by collecting their inner content as candidate JSON strings. Then also
  // scan the raw text for inline JSON objects.
  const candidates: string[] = [];

  // a) <tool_use>...</tool_use> blocks
  const xmlPattern = /<tool_use>\s*([\s\S]*?)\s*<\/tool_use>/gi;
  for (let m; (m = xmlPattern.exec(text)) !== null; ) {
    if (m[1]) candidates.push(m[1].trim());
  }

  // b) ```json ... ``` fenced blocks (accept 'json', 'tool_use', or unlabeled)
  const fencePattern = /```(?:json|tool_use)?\s*([\s\S]*?)```/g;
  for (let m; (m = fencePattern.exec(text)) !== null; ) {
    if (m[1]) candidates.push(m[1].trim());
  }

  // c) Raw inline JSON objects in the text. Regex can't balance braces across
  //    nested objects, so scan for `{` then walk forward counting brace depth
  //    (respecting strings) to find the matching close. Start only at braces
  //    whose first key looks like a tool call — `type`, `name`, or `tool`.
  const keyStartPattern = /\{\s*"(?:type|name|tool)"\s*:/g;
  for (let start; (start = keyStartPattern.exec(text)) !== null; ) {
    const end = findBalancedEnd(text, start.index);
    if (end > start.index) candidates.push(text.slice(start.index, end + 1));
  }

  for (const raw of candidates) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;

    // Normalise variants into {name, input}
    const name =
      (typeof parsed.name === "string" && parsed.name) ||
      (typeof parsed.tool === "string" && parsed.tool) ||
      null;
    const input =
      (parsed.input && typeof parsed.input === "object" ? parsed.input : null) ??
      (parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : null) ??
      {};
    if (!name) continue;

    // Accept either type:"tool_use" or no type (when the shape is clear)
    if (parsed.type !== undefined && parsed.type !== "tool_use") continue;

    const id =
      (typeof parsed.id === "string" && parsed.id) ||
      `call_${toolCalls.length}_${name}`;

    // Dedupe by semantic content (same name + same args) so the XML wrapper
    // candidate and the inline-JSON candidate of the same call don't both
    // get dispatched. The auto-generated id differs between candidates so
    // it can't be part of the dedup key.
    const semanticKey = `${name}:${stableStringify(input)}`;
    if (seen.has(semanticKey)) continue;
    seen.add(semanticKey);

    toolCalls.push({
      id,
      name,
      arguments: input as Record<string, unknown>,
    });
  }

  return toolCalls;
}

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(codexCliAdapter);
