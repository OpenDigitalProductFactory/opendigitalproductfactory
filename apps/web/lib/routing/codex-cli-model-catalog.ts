import { lazyChildProcess } from "@/lib/shared/lazy-node";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const MODEL_LIST_TIMEOUT_MS = 30_000;

type DiscoveredModel = { modelId: string; rawMetadata: Record<string, unknown> };

export type CodexCatalogLogin =
  | { type: "apiKey"; apiKey: string }
  | { type: "chatgptAuthTokens"; accessToken: string; chatgptAccountId: string; chatgptPlanType?: string };

/** Container-owned lifetime and state; the outer inference layer supplies auth. */
export const CODEX_CATALOG_RUNNER = `
const fs = require('node:fs');
const cp = require('node:child_process');
const home = fs.mkdtempSync('/tmp/dpf-codex-catalog-');
fs.chmodSync(home, 0o700);
const env = { ...process.env, CODEX_HOME: home };
delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
const child = cp.spawn('codex', ['-c', 'cli_auth_credentials_store="ephemeral"', 'app-server', '--stdio'], { cwd: home, env, stdio: 'inherit' });
let hardStop;
const stop = () => { child.kill('SIGTERM'); hardStop ??= setTimeout(() => child.kill('SIGKILL'), 5000); };
const watchdog = setTimeout(stop, 35000);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
const cleanup = (code) => { clearTimeout(watchdog); clearTimeout(hardStop); fs.rmSync(home, { recursive: true, force: true }); process.exitCode = code; };
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
    let settled = false;
    let nextId = 3;
    let expectedResponseId = 1;
    let receivedBytes = 0;
    const cursors = new Set<string>();
    const models: DiscoveredModel[] = [];
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.stdin?.end();
      if (err) proc.kill("SIGTERM");
      if (err) reject(err); else resolve(models);
    };
    const send = (payload: unknown) => proc.stdin?.write(`${JSON.stringify(payload)}\n`);
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
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: { id?: number | string; method?: string; result?: unknown; error?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
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
          expectedResponseId = nextId;
          send({ method: "model/list", id: nextId, params: { cursor: null, limit: 100 } });
        } else if (message.id === nextId) {
          if (message.error) return finish(new Error("Selected account Codex model/list failed"));
          try {
            const page = parseCodexModelListPage(message.result);
            models.push(...page.models);
            if (models.length > 5000) return finish(new Error("Codex model/list inventory exceeded its safe limit"));
            if (page.nextCursor) {
              if (cursors.has(page.nextCursor)) return finish(new Error("Codex model/list repeated a cursor"));
              cursors.add(page.nextCursor);
              nextId += 1;
              expectedResponseId = nextId;
              send({ method: "model/list", id: nextId, params: { cursor: page.nextCursor, limit: 100 } });
            } else {
              finish();
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
