import { describe, it, expect } from "vitest";
import { getServedContextTokens, setServedContextTokens } from "./dmr-runtime-config";

const API_ROOT = "http://model-runner.docker.internal";

describe("getServedContextTokens", () => {
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
