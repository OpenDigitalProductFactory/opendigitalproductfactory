import { modernizeMcpResult } from "./route-modern";

export type JsonRpcId = string | number | null;

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  httpStatus = 200,
): Response {
  const body: JsonRpcResponse = {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
  return jsonResponse(body, httpStatus);
}

export function jsonRpcOk(id: JsonRpcId, result: unknown, modern = false): Response {
  const wireResult = modern ? modernizeMcpResult(result) : result;
  return jsonResponse({ jsonrpc: "2.0", id, result: wireResult } satisfies JsonRpcResponse);
}
