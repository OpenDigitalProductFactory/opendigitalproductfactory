import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  getServedContextTokens,
  setServedContextTokens,
  getLocalThinkingBudgetEvidence,
  ensureLocalEmbedderOffGpu,
} from "./dmr-runtime-config";

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
  it("keeps the evidence when the runner is pinned resident (keep_alive is lifecycle, not parsing)", async () => {
    expect(await getLocalThinkingBudgetEvidence(API_ROOT, "ai/test", probe({ config: { "context-size": 131072, keep_alive: "-1" } })))
      .toMatchObject({ dialect: "llama.cpp-b9879", modelDigest: digest });
  });
  it.each([
    { template: "ordinary answer template" }, { config: { "context-size": 131072, "raw-runtime-flags": "--chat-template custom" } },
    { config: { "context-size": 131072, keep_alive: -1 } },
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
    expect(res.keepAlive).toBeNull();
  });

  it("reads the per-model keep_alive DMR stores beside context-size", async () => {
    const fetchImpl = (async () => ({ ok: true, status: 200,
      json: async () => [{ Config: { "context-size": 40960, keep_alive: "-1" } }],
    })) as unknown as typeof fetch;
    const res = await getServedContextTokens(API_ROOT, "qwen3-coder", fetchImpl);
    expect(res).toMatchObject({ supported: true, contextTokens: 40960, keepAlive: "-1", retained: {} });
  });

  it("returns the other stored keys so a later write can retain them", async () => {
    const fetchImpl = (async () => ({ ok: true, status: 200,
      json: async () => [{ Config: { "context-size": 40960, keep_alive: "-1", "runtime-flags": ["--spec-type", "ngram-mod"] } }],
    })) as unknown as typeof fetch;
    expect((await getServedContextTokens(API_ROOT, "m", fetchImpl)).retained).toEqual({ "runtime-flags": ["--spec-type", "ngram-mod"] });
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
  it("POSTs the model + context-size + resident keep_alive and verifies by read-back", async () => {
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
    // DMR's configure REPLACES the stored per-model config, so every write must
    // carry keep_alive too or a context write would restore the 5-minute unload.
    expect(post?.body).toBe(JSON.stringify({ model: "qwen3-coder", "context-size": 32768, keep_alive: "-1" }));
  });

  it("carries other stored keys through a context write instead of wiping them", async () => {
    const posts: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts.push(init.body as string); return { ok: true, status: 202, text: async () => "" } as unknown as Response; }
      return { ok: true, status: 200, json: async () => [{ Config: { "context-size": 40960 } }] } as unknown as Response;
    }) as unknown as typeof fetch;
    await setServedContextTokens(API_ROOT, "m", 40960, fetchImpl, { "runtime-flags": ["--spec-type", "ngram-mod"] });
    expect(JSON.parse(posts[0]!)).toEqual({ "runtime-flags": ["--spec-type", "ngram-mod"], model: "m", "context-size": 40960, keep_alive: "-1" });
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

describe("ensureLocalEmbedderOffGpu (BI-B60AFE7B)", () => {
  type Entry = { Mode: string; Config: Record<string, unknown> };
  function runtime(entries: Entry[], postStatus = 202) {
    const posts: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(init.body as string));
        return { ok: postStatus < 300, status: postStatus, text: async () => "runner already active" } as unknown as Response;
      }
      expect(url).toContain("_configure?model=nomic");
      return { ok: true, status: 200, json: async () => entries } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, posts };
  }
  const CPU = ["--device", "none"];

  it("pins the completion preload path before the embedding runner, both CPU-only", async () => {
    // DMR preloads every configured model through /v1/chat/completions, so an
    // embedding-mode write alone would load a GPU completion copy beside the
    // generation model: the very overcommit this fixes.
    const r = runtime([]);
    expect((await ensureLocalEmbedderOffGpu(API_ROOT, "nomic", r.fetchImpl)).status).toBe("applied");
    expect(r.posts).toEqual([
      { model: "nomic", mode: "completion", keep_alive: "0", "runtime-flags": CPU },
      { model: "nomic", mode: "embedding", keep_alive: "-1", "runtime-flags": CPU },
    ]);
  });

  it("is write-free once both modes are in place (DMR echoes 0 as 0s)", async () => {
    const r = runtime([
      { Mode: "completion", Config: { "runtime-flags": CPU, keep_alive: "0s" } },
      { Mode: "embedding", Config: { "runtime-flags": CPU, keep_alive: "-1" } },
    ]);
    expect((await ensureLocalEmbedderOffGpu(API_ROOT, "nomic", r.fetchImpl)).status).toBe("ok");
    expect(r.posts).toEqual([]);
  });

  it("rewrites only the mode that drifted", async () => {
    const r = runtime([
      { Mode: "completion", Config: { "runtime-flags": CPU, keep_alive: "0s" } },
      { Mode: "embedding", Config: { "context-size": 2048 } },
    ]);
    await ensureLocalEmbedderOffGpu(API_ROOT, "nomic", r.fetchImpl);
    expect(r.posts.map((p) => p.mode)).toEqual(["embedding"]);
  });

  it("reports a refused write as deferred, never as applied", async () => {
    const r = runtime([], 409);
    const res = await ensureLocalEmbedderOffGpu(API_ROOT, "nomic", r.fetchImpl);
    expect(res).toMatchObject({ status: "deferred" });
    expect(res.reason).toMatch(/runner already active/);
  });
});
