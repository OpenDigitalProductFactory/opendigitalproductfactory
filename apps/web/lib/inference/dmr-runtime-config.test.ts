import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getServedContextTokens, setServedContextTokens, getLocalThinkingBudgetEvidence } from "./dmr-runtime-config";

const API_ROOT = "http://model-runner.docker.internal";

describe("selected runtime thinking budget evidence", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const template = readFileSync(new URL("./fixtures/qwen38-chat-template.jinja", import.meta.url), "utf8");
  function probe(overrides: { template?: string; config?: object; engine?: string; digest?: string; duplicate?: boolean } = {}) {
    return (async (url: string) => ({ ok: true, status: 200, json: async () =>
      url.includes("_configure") ? Array(overrides.duplicate ? 2 : 1).fill({ Backend: "llama.cpp", Model: "ai/test", ModelID: digest, Mode: "completion", Config: overrides.config ?? { "context-size": 131072 } }) :
      url.includes("/status") ? { "llama.cpp": overrides.engine ?? "Running: llama.cpp b9879-metal (sha256:engine) build" } :
      { id: overrides.digest ?? digest, config: { gguf: { "tokenizer.chat_template": overrides.template ?? template } } },
    })) as unknown as typeof fetch;
  }
  it("binds the numeric dialect to the selected digest, runtime and template", async () => {
    expect(await getLocalThinkingBudgetEvidence(API_ROOT, "ai/test", probe())).toMatchObject({ dialect: "llama.cpp-b9879", modelDigest: digest });
  });
  it.each([
    { template: "ordinary answer template" }, { config: { "context-size": 131072, "raw-runtime-flags": "--chat-template custom" } },
    { engine: "Running: llama.cpp b7000-metal" }, { digest: `sha256:${"b".repeat(64)}` }, { duplicate: true },
  ])("leaves unsupported, overridden or ambiguous evidence unknown: %j", async overrides => {
    expect(await getLocalThinkingBudgetEvidence(API_ROOT, "ai/test", probe(overrides))).toBeUndefined();
  });
  it.each([
    "{# '<think>\\n' '\\n</think>\\n\\n' #}{{ 'Ordinary answer' }}",
    "{% if false %}{{ '<think>\\n' }}{{ '\\n</think>\\n\\n' }}{% endif %}{{ 'Ordinary answer' }}",
  ])("does not infer parser support from unused delimiters", async template => {
    expect(await getLocalThinkingBudgetEvidence(API_ROOT, "ai/test", probe({ template }))).toBeUndefined();
  });
});

describe("getServedContextTokens", () => {
  it.each([0, -1, 1.5, NaN, Infinity, "40960", null])("rejects an invalid explicit context override: %s", async (size) => {
    const fetchImpl = (async () => ({ ok: true, status: 200,
      json: async () => [{ Config: { "context-size": size } }],
    })) as unknown as typeof fetch;
    const res = await getServedContextTokens(API_ROOT, "qwen3-coder", fetchImpl);
    expect(res.supported).toBe(false);
    expect(res.contextTokens).toBeNull();
    expect(res.reason).toMatch(/invalid context/i);
  });

  it("parses the context-size from a DMR configure response", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toContain("/engines/_configure?model=");
      return {
        ok: true,
        status: 200,
        json: async () => [{ Backend: "llama.cpp", Model: "docker.io/ai/qwen3-coder:latest", Config: { "context-size": 32768 } }],
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const res = await getServedContextTokens(API_ROOT, "qwen3-coder", fetchImpl);
    expect(res.supported).toBe(true);
    expect(res.contextTokens).toBe(32768);
  });

  it("reports supported=true, contextTokens=null when no runtime override is set", async () => {
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch;
    const res = await getServedContextTokens(API_ROOT, "gemma4:12B", fetchImpl);
    expect(res.supported).toBe(true);
    expect(res.contextTokens).toBeNull();
  });

  it("reports supported=false on 404 (endpoint not available)", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404, json: async () => [], text: async () => "" })) as unknown as typeof fetch;
    const res = await getServedContextTokens(API_ROOT, "x", fetchImpl);
    expect(res.supported).toBe(false);
    expect(res.contextTokens).toBeNull();
  });

  it("never throws on a network error", async () => {
    const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const res = await getServedContextTokens(API_ROOT, "x", fetchImpl);
    expect(res.supported).toBe(false);
    expect(res.reason).toContain("unreachable");
  });
});

describe("setServedContextTokens", () => {
  it("POSTs the model + context-size and verifies by read-back", async () => {
    const calls: Array<{ method?: string; body?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method, body: init?.body as string | undefined });
      if (init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" } as unknown as Response;
      }
      // verification read-back
      return { ok: true, status: 200, json: async () => [{ Config: { "context-size": 32768 } }] } as unknown as Response;
    }) as unknown as typeof fetch;

    const res = await setServedContextTokens(API_ROOT, "qwen3-coder", 32768, fetchImpl);
    expect(res.ok).toBe(true);
    expect(res.contextTokens).toBe(32768);
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toBe(JSON.stringify({ model: "qwen3-coder", "context-size": 32768 }));
  });

  it("surfaces a 404 as an unsupported-runtime reason", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404, text: async () => "" })) as unknown as typeof fetch;
    const res = await setServedContextTokens(API_ROOT, "x", 22000, fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/does not expose/i);
  });

  it("surfaces a non-OK write (e.g. runner already active) with detail", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 409, text: async () => "runner already active" })) as unknown as typeof fetch;
    const res = await setServedContextTokens(API_ROOT, "x", 22000, fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/runner already active/i);
  });
});
