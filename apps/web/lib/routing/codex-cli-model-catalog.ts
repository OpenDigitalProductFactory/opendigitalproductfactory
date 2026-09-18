import { lazyChildProcess } from "@/lib/shared/lazy-node";
import { prepareCodexCliAuth } from "./codex-cli-adapter";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const MODEL_LIST_TIMEOUT_MS = 30_000;

type DiscoveredModel = { modelId: string; rawMetadata: Record<string, unknown> };

export function parseCodexModelListPage(value: unknown): {
  models: DiscoveredModel[];
  nextCursor: string | null;
} {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) {
    throw new Error("Malformed Codex model/list response");
  }
  const page = value as { data: unknown[]; nextCursor?: unknown };
  const models = page.data.flatMap((entry): DiscoveredModel[] => {
    if (!entry || typeof entry !== "object") return [];
    const metadata = entry as Record<string, unknown>;
    const modelId = typeof metadata.model === "string"
      ? metadata.model
      : typeof metadata.id === "string" ? metadata.id : null;
    if (!modelId || metadata.hidden === true) return [];
    return [{ modelId, rawMetadata: { ...metadata, source: "codex_cli_model_list" } }];
  });
  return {
    models,
    nextCursor: typeof page.nextCursor === "string" ? page.nextCursor : null,
  };
}

export async function discoverCodexCliModels(providerId = "codex"): Promise<DiscoveredModel[]> {
  const auth = await prepareCodexCliAuth(providerId);
  const args = ["exec", "-i"];
  if (auth.mode === "apikey") args.push("-e", "OPENAI_API_KEY");
  args.push(SANDBOX_CONTAINER, "codex", "app-server", "--stdio");

  return new Promise<DiscoveredModel[]>((resolve, reject) => {
    const proc = lazyChildProcess().spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: auth.mode === "apikey"
        ? { ...process.env, OPENAI_API_KEY: auth.apiKey }
        : process.env,
    });
    let buffer = "";
    let stderr = "";
    let settled = false;
    let nextId = 2;
    const models: DiscoveredModel[] = [];
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.stdin?.end();
      proc.kill("SIGTERM");
      if (err) reject(err); else resolve(models);
    };
    const send = (payload: unknown) => proc.stdin?.write(`${JSON.stringify(payload)}\n`);
    const timer = setTimeout(
      () => finish(new Error(`Codex model/list timed out after ${MODEL_LIST_TIMEOUT_MS / 1000}s`)),
      MODEL_LIST_TIMEOUT_MS,
    );

    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: { id?: number; result?: unknown; error?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          send({ method: "model/list", id: nextId, params: { cursor: null, limit: 100 } });
        } else if (message.id === nextId) {
          if (message.error) return finish(new Error(`Codex model/list failed: ${JSON.stringify(message.error)}`));
          try {
            const page = parseCodexModelListPage(message.result);
            models.push(...page.models);
            if (page.nextCursor) {
              nextId += 1;
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
    proc.on("error", (err: Error) => finish(err));
    proc.on("close", (code: number | null) => {
      if (!settled) finish(new Error(`Codex app-server exited ${code ?? "?"}: ${stderr.slice(0, 300)}`));
    });
    send({
      method: "initialize",
      id: 1,
      params: { clientInfo: { name: "dpf-model-catalog", version: "1.0.0" }, capabilities: {} },
    });
  });
}
