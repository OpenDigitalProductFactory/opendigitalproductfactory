// Newline-delimited JSON-RPC 2.0 over a child process's stdio: the transport
// Codex `app-server` speaks (BI-05715F4C). Requests get responses, the server's
// notifications go to one handler, and the server's own requests (approvals)
// go to another whose answer is written back with the same id.

import { StringDecoder } from "node:string_decoder";

export type JsonRpcStreams = {
  write(line: string): void;
  onData(listener: (chunk: Buffer | string) => void): void;
  onClose(listener: (code: number | null) => void): void;
  end(): void;
};

export type JsonRpcPeerOptions = {
  onNotification: (method: string, params: Record<string, unknown>) => void;
  onServerRequest: (id: string | number, method: string, params: Record<string, unknown>) => void;
  onClose: (code: number | null) => void;
  requestTimeoutMs?: number;
  maxLineBytes?: number;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class JsonRpcError extends Error {
  constructor(readonly method: string, readonly code: number | null, message: string) {
    super(`${method}: ${message}`);
    this.name = "JsonRpcError";
  }
}

export type JsonRpcPeer = {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  notify(method: string, params?: Record<string, unknown>): void;
  respond(id: string | number, result: unknown): void;
  respondError(id: string | number, code: number, message: string): void;
  close(): void;
};

export function createJsonRpcPeer(streams: JsonRpcStreams, options: JsonRpcPeerOptions): JsonRpcPeer {
  const pending = new Map<string | number, Pending & { method: string }>();
  const decoder = new StringDecoder("utf8");
  const maxLineBytes = options.maxLineBytes ?? 8 * 1024 * 1024;
  const timeoutMs = options.requestTimeoutMs ?? 60_000;
  let nextId = 1;
  let buffer = "";
  let closed = false;

  const send = (frame: Record<string, unknown>) => {
    if (!closed) streams.write(`${JSON.stringify(frame)}\n`);
  };

  const failAll = (reason: string) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new JsonRpcError(entry.method, null, reason));
      pending.delete(id);
    }
  };

  const handleLine = (line: string) => {
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    const id = frame["id"] as string | number | undefined;
    const method = typeof frame["method"] === "string" ? frame["method"] : null;
    const params = (frame["params"] && typeof frame["params"] === "object" ? frame["params"] : {}) as Record<string, unknown>;
    if (method && id != null) return options.onServerRequest(id, method, params);
    if (method) return options.onNotification(method, params);
    if (id == null) return;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    const error = frame["error"] as { code?: number; message?: string } | undefined;
    if (error) entry.reject(new JsonRpcError(entry.method, error.code ?? null, error.message ?? "request failed"));
    else entry.resolve(frame["result"]);
  };

  streams.onData((chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (Buffer.byteLength(buffer) > maxLineBytes) {
      buffer = "";
      return;
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) handleLine(line);
  });
  streams.onClose((code) => {
    closed = true;
    failAll(`the runtime exited (${code ?? "signal"})`);
    options.onClose(code);
  });

  return {
    request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      if (closed) return Promise.reject(new JsonRpcError(method, null, "the runtime is not running"));
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new JsonRpcError(method, null, `no response in ${timeoutMs / 1000}s`));
        }, timeoutMs);
        pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
        send({ id, method, params });
      });
    },
    notify(method, params) {
      send(params ? { method, params } : { method });
    },
    respond(id, result) {
      send({ id, result });
    },
    respondError(id, code, message) {
      send({ id, error: { code, message } });
    },
    close() {
      if (closed) return;
      closed = true;
      failAll("the session closed");
      streams.end();
    },
  };
}
