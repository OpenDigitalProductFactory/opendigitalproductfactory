import { lazyChildProcess } from "@/lib/shared/lazy-node";
import { StringDecoder } from "node:string_decoder";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const MODEL_LIST_TIMEOUT_MS = 30_000;
const PROVENANCE_METHOD = "dpf/catalog-provenance";

type DiscoveredModel = { modelId: string; rawMetadata: Record<string, unknown> };

export type CodexCatalogLogin =
  | { type: "apiKey"; apiKey: string }
  | { type: "chatgptAuthTokens"; accessToken: string; chatgptAccountId: string; chatgptPlanType?: string };

/** Container-owned lifetime and state; the outer inference layer supplies auth. */
export const CODEX_CATALOG_RUNNER = String.raw`
const fs = require('node:fs');
const cp = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const home = fs.mkdtempSync('/tmp/dpf-codex-catalog-');
fs.chmodSync(home, 0o700);
const env = { ...process.env, CODEX_HOME: home };
delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
const child = cp.spawn('codex', ['-c', 'cli_auth_credentials_store="ephemeral"', 'app-server', '--stdio'], { cwd: home, env, stdio: ['pipe', 'pipe', 'inherit'] });
let hardStop;
const stop = () => { child.kill('SIGTERM'); hardStop ??= setTimeout(() => child.kill('SIGKILL'), 5000); };
const watchdog = setTimeout(stop, 35000);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
const maxBytes = 4 * 1024 * 1024;
let loginStartedAt = null;
let input = '';
const inputDecoder = new StringDecoder('utf8');
let inputFailed = false;
child.stdin.on('error', () => { inputFailed = true; stop(); });
process.stdin.on('data', (chunk) => {
  if (inputFailed) return;
  input += inputDecoder.write(chunk);
  if (Buffer.byteLength(input) > maxBytes) return stop();
  const lines = input.split('\n'); input = lines.pop() ?? '';
  for (const line of lines) {
    try { if (JSON.parse(line).method === 'account/login/start') loginStartedAt = Date.now(); } catch {}
  }
  child.stdin.write(chunk);
});
process.stdin.on('end', () => { if (!inputFailed) child.stdin.end(); });
const provenance = (message) => {
  const missing = { responseId: message.id, verified: false };
  try {
    if (loginStartedAt === null) return missing;
    const cachePath = home + '/models_cache.json';
    const file = fs.lstatSync(cachePath);
    if (!file.isFile() || file.size > maxBytes) return missing;
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const fetchedAt = Date.parse(cache.fetched_at);
    if (!Number.isFinite(fetchedAt) || fetchedAt < loginStartedAt || fetchedAt > Date.now() + 1000
      || typeof cache.identity !== 'string' || !cache.identity.trim()
      || typeof cache.client_version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(cache.client_version)
      || !Array.isArray(cache.models) || cache.models.length > 5000
      || !cache.models.every((model) => model && typeof model.slug === 'string' && model.slug.trim())) return missing;
    const remoteIds = new Set(cache.models.map((model) => model.slug));
    if (!message.result.data.every((model) => model && remoteIds.has(typeof model.model === 'string' ? model.model : model.id))) return missing;
    return { responseId: message.id, verified: true, clientVersion: cache.client_version, fetchedAt: cache.fetched_at };
  } catch { return missing; }
};
let output = '';
const outputDecoder = new StringDecoder('utf8');
child.stdout.on('data', (chunk) => {
  output += outputDecoder.write(chunk);
  if (Buffer.byteLength(output) > maxBytes) return stop();
  const lines = output.split('\n'); output = lines.pop() ?? '';
  for (const line of lines) {
    try {
      const message = JSON.parse(line);
      if (Number.isSafeInteger(message.id) && message.id >= 3 && Array.isArray(message.result?.data)) {
        process.stdout.write(JSON.stringify({ method: ${JSON.stringify(PROVENANCE_METHOD)}, params: provenance(message) }) + '\n');
      }
    } catch {}
    process.stdout.write(line + '\n');
  }
});
const cleanup = (code) => { clearTimeout(watchdog); clearTimeout(hardStop); fs.rmSync(home, { recursive: true, force: true }); process.exitCode = inputFailed ? 1 : code; };
child.on('error', () => cleanup(1));
child.on('exit', (code) => cleanup(code ?? 1));
`;

export function parseCodexModelListPage(value: unknown): {
  models: DiscoveredModel[];
  nextCursor: string | null;
} {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) {
    throw new Error("Malformed Codex model/list response");
  }
  const page = value as { data: unknown[]; nextCursor?: unknown };
  if (page.nextCursor != null && typeof page.nextCursor !== "string") {
    throw new Error("Malformed Codex model/list cursor");
  }
  const models = page.data.flatMap((entry): DiscoveredModel[] => {
    if (!entry || typeof entry !== "object") throw new Error("Malformed Codex model/list entry");
    const metadata = entry as Record<string, unknown>;
    const modelId = typeof metadata.model === "string"
      ? metadata.model
      : typeof metadata.id === "string" ? metadata.id : null;
    if (!modelId?.trim()) throw new Error("Malformed Codex model/list model ID");
    if (metadata.hidden === true) return [];
    return [{ modelId, rawMetadata: { ...metadata, source: "codex_cli_model_list" } }];
  });
  return {
    models,
    nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
  };
}

export async function discoverCodexCliModels(login: CodexCatalogLogin): Promise<DiscoveredModel[]> {
  const args = ["exec", "-i", "-e", "OPENAI_API_KEY=", "-e", "CODEX_API_KEY=", SANDBOX_CONTAINER, "node", "-e", CODEX_CATALOG_RUNNER];
  const childEnv = { ...process.env };
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.CODEX_API_KEY;

  return new Promise<DiscoveredModel[]>((resolve, reject) => {
    const proc = lazyChildProcess().spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
    });
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    let settled = false;
    let nextId = 3;
    let expectedResponseId = 1;
    let receivedBytes = 0;
    const cursors = new Set<string>();
    const models: DiscoveredModel[] = [];
    let verifiedResponseId: number | null = null;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.stdin?.end();
      if (err) proc.kill("SIGTERM");
      if (err) reject(err); else resolve(models);
    };
    const send = (payload: unknown) => proc.stdin?.write(`${JSON.stringify(payload)}\n`);
    const sendPage = (cursor: string | null) => {
      expectedResponseId = nextId;
      verifiedResponseId = null;
      send({ method: "model/list", id: nextId, params: { cursor, limit: 100 } });
    };
    const timer = setTimeout(
      () => finish(new Error(`Codex model/list timed out after ${MODEL_LIST_TIMEOUT_MS / 1000}s`)),
      MODEL_LIST_TIMEOUT_MS,
    );

    // Drain stderr without exposing token-bearing provider or process errors.
    proc.stderr?.on("data", () => {});
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      receivedBytes += chunk.length;
      if (receivedBytes > 4 * 1024 * 1024) return finish(new Error("Codex model/list response exceeded its safe size limit"));
      buffer += decoder.write(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.method === PROVENANCE_METHOD) {
          const proof = message.params as { responseId?: unknown; verified?: unknown; clientVersion?: unknown; fetchedAt?: unknown } | null;
          if (expectedResponseId < 3 || proof?.responseId !== expectedResponseId || proof.verified !== true
            || typeof proof.clientVersion !== "string" || !proof.clientVersion.trim()
            || typeof proof.fetchedAt !== "string" || !Number.isFinite(Date.parse(proof.fetchedAt))) {
            return finish(new Error("Current Codex model catalog could not be verified"));
          }
          verifiedResponseId = expectedResponseId;
          continue;
        }
        if (message.method && message.id != null) {
          // A new token requires fresh selected-account authentication; never
          // refresh or fall back through another account inside this invocation.
          send({ id: message.id, error: { code: -32000, message: "Selected account must be re-authenticated" } });
          return finish(new Error("Selected account needs authentication — retry its discovery"));
        }
        if (message.id == null) continue;
        if (message.id !== expectedResponseId) return finish(new Error("Unexpected Codex catalog response before the current request completed"));
        if (message.id === 1) {
          if (message.error || !message.result || typeof message.result !== "object") return finish(new Error("Codex app-server initialization failed"));
          send({ method: "initialized", params: {} });
          expectedResponseId = 2;
          send({ method: "account/login/start", id: 2, params: login });
        } else if (message.id === 2) {
          if (message.error || !message.result || (message.result as { type?: unknown }).type !== login.type) return finish(new Error("Selected account Codex login failed"));
          sendPage(null);
        } else if (message.id === nextId) {
          if (message.error) return finish(new Error("Selected account Codex model/list failed"));
          if (verifiedResponseId !== message.id) return finish(new Error("Current Codex model catalog could not be verified"));
          try {
            const page = parseCodexModelListPage(message.result);
            models.push(...page.models);
            if (models.length > 5000) return finish(new Error("Codex model/list inventory exceeded its safe limit"));
            if (page.nextCursor) {
              if (cursors.has(page.nextCursor)) return finish(new Error("Codex model/list repeated a cursor"));
              cursors.add(page.nextCursor);
              nextId += 1;
              sendPage(page.nextCursor);
            } else {
              finish(models.length ? undefined : new Error("Codex model catalog returned no visible models"));
            }
          } catch (err) {
            finish(err instanceof Error ? err : new Error("Malformed Codex model/list response"));
          }
        }
      }
    });
    proc.on("error", () => finish(new Error("Codex catalog process could not start")));
    proc.on("close", (code: number | null) => {
      if (!settled) finish(new Error(`Codex app-server exited ${code ?? "?"} before completing model discovery`));
    });
    send({
      method: "initialize",
      id: 1,
      params: { clientInfo: { name: "dpf-model-catalog", version: "1.0.0" }, capabilities: { experimentalApi: true } },
    });
  });
}
