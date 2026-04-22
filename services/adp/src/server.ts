// ADP MCP server entry point.
// P0.4 scaffold: health endpoint + empty MCP tools/list. Tool handlers land in P2.

import { createServer, IncomingMessage, ServerResponse } from "node:http";

const PORT = Number.parseInt(process.env.PORT ?? "8600", 10);
const SERVICE_NAME = "adp";
const SERVICE_VERSION = "0.1.0";

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

function handleMcp(request: JsonRpcRequest): JsonRpcResponse {
  switch (request.method) {
    case "tools/list":
      return { jsonrpc: "2.0", id: request.id, result: { tools: [] } };
    case "tools/call":
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "No tools registered yet — P0 scaffold only" },
      };
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
      sendJson(res, 200, handleMcp(request));
    } catch (err) {
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
  console.log(`[${SERVICE_NAME}] listening on :${PORT}`);
});

process.on("SIGTERM", () => {
  console.log(`[${SERVICE_NAME}] SIGTERM received, closing`);
  server.close(() => process.exit(0));
});
