// ADP MCP server entry point.
// HTTP JSON-RPC over POST /mcp. Health at GET /health.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { listWorkers, TOOL_DEFINITION as LIST_WORKERS_DEF } from "./tools/list-workers.js";

const PORT = Number.parseInt(process.env.PORT ?? "8600", 10);
const SERVICE_NAME = "adp";
const SERVICE_VERSION = "0.2.0";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolsCallParams {
  name: string;
  arguments?: unknown;
  _meta?: {
    coworkerId?: string;
    userId?: string | null;
  };
}

type ToolHandler = (args: unknown, ctx: { coworkerId: string; userId: string | null }) => Promise<unknown>;

// Registry of callable tools. Add new tools here as they land.
const TOOLS: Record<string, { definition: typeof LIST_WORKERS_DEF; handler: ToolHandler }> = {
  adp_list_workers: { definition: LIST_WORKERS_DEF, handler: listWorkers },
};

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

async function handleMcp(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  switch (request.method) {
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { tools: Object.values(TOOLS).map((t) => t.definition) },
      };
    case "tools/call": {
      const params = request.params as ToolsCallParams | undefined;
      const toolName = params?.name;
      if (!toolName || !(toolName in TOOLS)) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `Tool not found: ${toolName ?? "<unset>"}` },
        };
      }
      const ctx = {
        coworkerId: params?._meta?.coworkerId ?? "unknown",
        userId: params?._meta?.userId ?? null,
      };
      try {
        const result = await TOOLS[toolName]!.handler(params?.arguments, ctx);
        return { jsonrpc: "2.0", id: request.id, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : undefined;
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: code ? `${code}: ${message}` : message },
        };
      }
    }
    default:
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, service: SERVICE_NAME, version: SERVICE_VERSION });
    return;
  }

  if (req.method === "POST" && req.url === "/mcp") {
    try {
      const body = await readBody(req);
      const request = JSON.parse(body) as JsonRpcRequest;
      if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid request" },
        });
        return;
      }
      sendJson(res, 200, await handleMcp(request));
    } catch {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] listening on :${PORT} (v${SERVICE_VERSION})`);
});

process.on("SIGTERM", () => {
  console.log(`[${SERVICE_NAME}] SIGTERM received, closing`);
  server.close(() => process.exit(0));
});
