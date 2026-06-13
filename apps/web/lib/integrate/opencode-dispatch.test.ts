import { describe, it, expect } from "vitest";
import {
  sandboxReachableUrl,
  preflightLocalEndpoint,
  buildOpencodeConfig,
  summarizeOpencodeEvent,
  extractOpencodeResult,
} from "./opencode-dispatch";

describe("sandboxReachableUrl", () => {
  it("rewrites localhost to host.docker.internal preserving port", () => {
    expect(sandboxReachableUrl("http://localhost:11434/v1")).toBe("http://host.docker.internal:11434/v1");
  });

  it("rewrites 127.0.0.1 to host.docker.internal", () => {
    expect(sandboxReachableUrl("http://127.0.0.1:8000/v1")).toBe("http://host.docker.internal:8000/v1");
  });

  it("leaves docker-internal hostnames untouched", () => {
    const url = "http://model-runner.docker.internal/v1";
    expect(sandboxReachableUrl(url)).toBe(url);
  });

  it("is overridable via OPENCODE_SANDBOX_BASE_URL", () => {
    process.env.OPENCODE_SANDBOX_BASE_URL = "http://custom:9999/v1";
    try {
      expect(sandboxReachableUrl("http://localhost:11434/v1")).toBe("http://custom:9999/v1");
    } finally {
      delete process.env.OPENCODE_SANDBOX_BASE_URL;
    }
  });
});

function modelsResponse(models: Array<string | { id: string; context_length?: number }>) {
  return {
    ok: true,
    json: async () => ({
      data: models.map((m) => (typeof m === "string" ? { id: m } : m)),
    }),
  } as Response;
}

describe("preflightLocalEndpoint", () => {
  it("blocks when the endpoint is unreachable", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "qwen", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("unreachable");
  });

  it("blocks on non-200", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "qwen", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("HTTP 503");
  });

  it("blocks when no models are served", async () => {
    const fetchImpl = (async () => modelsResponse([])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("no models");
  });

  it("blocks when the requested model is absent and lists what's available", async () => {
    const fetchImpl = (async () => modelsResponse(["qwen3-coder", "gemma"])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "deepseek", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("qwen3-coder");
  });

  it("resolves the requested model when present", async () => {
    const fetchImpl = (async () => modelsResponse(["qwen3-coder", "gemma"])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "qwen3-coder", fetchImpl);
    expect(res.ok).toBe(true);
    expect(res.resolvedModel).toBe("qwen3-coder");
  });

  it("falls back to the first served model when none requested", async () => {
    const fetchImpl = (async () => modelsResponse(["first-model", "second"])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "", fetchImpl);
    expect(res.ok).toBe(true);
    expect(res.resolvedModel).toBe("first-model");
  });

  it("enforces the context floor only when the endpoint reports it", async () => {
    const fetchImpl = (async () =>
      modelsResponse([{ id: "tiny", context_length: 4096 }])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "tiny", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("context");
  });

  it("passes when reported context clears the floor", async () => {
    const fetchImpl = (async () =>
      modelsResponse([{ id: "big", context_length: 131072 }])) as unknown as typeof fetch;
    const res = await preflightLocalEndpoint("http://localhost:11434/v1", "big", fetchImpl);
    expect(res.ok).toBe(true);
  });
});

describe("buildOpencodeConfig", () => {
  it("declares a local OpenAI-compatible provider with the model and allow permission", () => {
    const cfg = JSON.parse(buildOpencodeConfig("http://host.docker.internal:11434/v1", "qwen3-coder"));
    expect(cfg.provider.local.npm).toBe("@ai-sdk/openai-compatible");
    expect(cfg.provider.local.options.baseURL).toBe("http://host.docker.internal:11434/v1");
    expect(cfg.provider.local.models["qwen3-coder"]).toBeDefined();
    expect(cfg.model).toBe("local/qwen3-coder");
    expect(cfg.permission).toBe("allow");
  });
});

describe("summarizeOpencodeEvent", () => {
  it("summarizes a tool/file event", () => {
    expect(summarizeOpencodeEvent('{"type":"tool_use","tool":"edit","path":"apps/web/x.ts"}')).toBe("edit: apps/web/x.ts");
  });
  it("returns Thinking for reasoning events", () => {
    expect(summarizeOpencodeEvent('{"type":"thinking"}')).toBe("Thinking...");
  });
  it("ignores non-JSON and unknown lines", () => {
    expect(summarizeOpencodeEvent("plain log line")).toBeNull();
    expect(summarizeOpencodeEvent('{"type":"noise"}')).toBeNull();
  });
});

describe("extractOpencodeResult", () => {
  it("returns the last result/message text from a JSON stream", () => {
    const stream = [
      '{"type":"tool_use","tool":"edit","path":"x"}',
      '{"type":"message","text":"first"}',
      '{"type":"result","text":"final answer"}',
    ].join("\n");
    expect(extractOpencodeResult(stream)).toBe("final answer");
  });

  it("falls back to raw stdout when no recognized events", () => {
    expect(extractOpencodeResult("just text output")).toBe("just text output");
  });
});
