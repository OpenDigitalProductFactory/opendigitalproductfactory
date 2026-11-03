import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    modelProfile: { updateMany: vi.fn(), findMany: vi.fn() },
    modelProvider: { findUnique: vi.fn() },
    aiProviderConnection: { findUnique: vi.fn() },
    platformConfig: { findUnique: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma, DISCOVERY_TRIAGE_AGENT_ID: "discovery-triage" }));

import {
  reconcileLocalModelContext,
  reconcileLocalEmbedderPlacement,
  resolveLocalServedContextTokens,
  resolveLocalServingPosture,
  resolveServedContextTarget,
  resolveHostMemoryProfile,
} from "./local-model-context-reconcile";
import { RECOMMENDED_BUILD_CONTEXT_TOKENS, MAX_LOCAL_CONTEXT_TOKENS } from "./local-model-policy";

// host_profile as the live install persists it (Windows/flat shape): RTX 4090.
const HOST_4090 = { gpuVramGB: 24, ramGB: 63.7, selectedModel: "ai/qwen3-coder" };

/** Route platformConfig.findUnique by key so a test can set the override and the
 *  host_profile independently. */
function configByKey(map: Record<string, unknown>) {
  return (args?: { where?: { key?: string } }) => {
    const key = args?.where?.key;
    return Promise.resolve(key && map[key] !== undefined ? { key, value: map[key] } : null);
  };
}

describe("resolveServedContextTarget — resource-aware (BI-3E614946)", () => {
  it("falls back to the build floor when the host profile is unknown", async () => {
    mockPrisma.platformConfig.findUnique.mockImplementation(configByKey({}));
    expect(await resolveServedContextTarget()).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
  });

  it("derives the default from VRAM: a 24 GB 4090 running the 30B coder sizes to the floor honestly", async () => {
    mockPrisma.platformConfig.findUnique.mockImplementation(configByKey({ host_profile: HOST_4090 }));
    // 24 - 16 - 5 = 3 GB KV ≈ 24,576 — the hardware genuinely can't serve more with this model.
    expect(await resolveServedContextTarget()).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
  });

  it("derives a LARGER default when a smaller model leaves KV room (8B on 24 GB)", async () => {
    mockPrisma.platformConfig.findUnique.mockImplementation(
      configByKey({ host_profile: { ...HOST_4090, selectedModel: "ai/qwen3:8B-Q4_K_M" } }),
    );
    expect(await resolveServedContextTarget()).toBe(122_880);
  });

  it("trusts an explicit operator pin ABOVE the estimated ceiling, clamped only to MAX (BI-F4D3B9E9)", async () => {
    mockPrisma.platformConfig.findUnique.mockImplementation(
      configByKey({ host_profile: HOST_4090, "local.servedContextTokens": 200_000 }),
    );
    // The weights+KV estimate says a 24 GB card on the 30B caps at the floor, but
    // the estimate measurably under-sizes MoE models (40k serves fine on this
    // exact host). An explicit pin is the operator's documented mechanism for
    // going higher — honor it, bounded only by the hard MAX.
    expect(await resolveServedContextTarget()).toBe(MAX_LOCAL_CONTEXT_TOKENS);
  });

  it("honors a measured-realistic pin (40k on the 24 GB 4090 + 30B MoE) verbatim", async () => {
    mockPrisma.platformConfig.findUnique.mockImplementation(
      configByKey({ host_profile: HOST_4090, "local.servedContextTokens": 40_960 }),
    );
    expect(await resolveServedContextTarget()).toBe(40_960);
  });

  it("trusts an operator override up to MAX when the host is unknown", async () => {
    mockPrisma.platformConfig.findUnique.mockImplementation(
      configByKey({ "local.servedContextTokens": 200_000 }),
    );
    expect(await resolveServedContextTarget()).toBe(MAX_LOCAL_CONTEXT_TOKENS);
  });

  it("resolveHostMemoryProfile normalizes the persisted host_profile", async () => {
    mockPrisma.platformConfig.findUnique.mockImplementation(configByKey({ host_profile: HOST_4090 }));
    expect(await resolveHostMemoryProfile()).toEqual({
      host: { architecture: "discrete", vramGb: 24, totalRamGb: 63.7 },
      selectedModel: "ai/qwen3-coder",
    });
  });
});

// Default: no operator override set → target is the build floor. Individual tests
// override per case. Set in beforeEach because clearAllMocks() clears calls but
// not implementations, so a prior test's mockResolvedValue would otherwise leak.
beforeEach(() => {
  mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
  mockPrisma.modelProvider.findUnique.mockReset().mockResolvedValue({ providerId: "local", status: "active" });
  mockPrisma.aiProviderConnection.findUnique.mockReset().mockResolvedValue({ status: "active" });
});
afterEach(() => vi.clearAllMocks());

const GEN = "docker.io/ai/qwen3-coder:latest";
const EMBED = "docker.io/ai/nomic-embed-text-v1.5:latest";

// A stateful DMR fetch double. `configured` is the current `_configure` override
// the GET reports (null = unset); a successful POST flips it to the requested
// value, mirroring DMR's read-back-after-write contract.
function makeFetch(opts: {
  models?: Array<{ id: string }>;
  configured?: number | null;
  /** Stored keep_alive; defaults to resident ("-1") whenever an override is set. */
  keepAlive?: string | null;
  /** Other stored config keys (e.g. runtime-flags) the GET reports. */
  extra?: Record<string, unknown>;
  postStatus?: number;
  modelsStatus?: number;
  /** `/engines/status` llama.cpp identity; defaults to an engine not qualified for speculation. */
  engine?: string;
}) {
  let configured = opts.configured ?? null;
  let keepAlive = opts.keepAlive !== undefined ? opts.keepAlive : configured == null ? null : "-1";
  let extra = opts.extra ?? {};
  const calls = { post: 0, getConfigure: 0, models: 0, postBodies: [] as Array<Record<string, unknown>> };
  const config = () => ({ ...extra, "context-size": configured, ...(keepAlive == null ? {} : { keep_alive: keepAlive }) });
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("_configure")) {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST") {
        calls.post++;
        const status = opts.postStatus ?? 202;
        const ok = status >= 200 && status < 300;
        const body = JSON.parse(String(init?.body ?? "{}")) as { "context-size"?: number; keep_alive?: string };
        calls.postBodies.push(body);
        if (ok) {
          // DMR replaces the stored config wholesale on configure.
          const { model: _model, "context-size": size, keep_alive: ka, ...rest } = body as Record<string, unknown>;
          configured = (size as number | undefined) ?? null;
          keepAlive = (ka as string | undefined) ?? null;
          extra = rest;
        }
        return { ok, status, text: async () => "", json: async () => [{ Config: config() }] } as unknown as Response;
      }
      calls.getConfigure++;
      const entry = configured == null ? {} : { Config: config() };
      return { ok: true, status: 200, json: async () => [entry] } as unknown as Response;
    }
    if (u.endsWith("/engines/status")) {
      return { ok: true, status: 200, json: async () => ({ "llama.cpp": opts.engine ?? "Running: llama.cpp b7000-cpu (sha256:x) build" }) } as unknown as Response;
    }
    if (u.includes("/models")) {
      calls.models++;
      const status = opts.modelsStatus ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => ({ data: opts.models ?? [{ id: GEN }] }) } as unknown as Response;
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("reconcileLocalModelContext", () => {
  it("raises the served context when DMR has no override (regressed to its default)", async () => {
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
    const f = makeFetch({ configured: null });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("raised");
    expect(r.modelId).toBe(GEN);
    expect(r.before).toBeNull();
    expect(r.after).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
    expect(f.calls.post).toBe(1);
    expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { maxContextTokens: RECOMMENDED_BUILD_CONTEXT_TOKENS } }),
    );
  });

  it("raises when the override sits below target (e.g. 4096 after a DMR restart)", async () => {
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
    const f = makeFetch({ configured: 4096 });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("raised");
    expect(r.before).toBe(4096);
    expect(r.after).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
  });

  it("is a no-op (no POST) when already at/above target — DB write is conditional repair only", async () => {
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
    const f = makeFetch({ configured: RECOMMENDED_BUILD_CONTEXT_TOKENS });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("ok");
    expect(r.before).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
    expect(f.calls.post).toBe(0);
    // No DMR write, but a conditional column-repair update is issued (count 0 = nothing stale).
    expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ maxContextTokens: null }, { maxContextTokens: { lt: RECOMMENDED_BUILD_CONTEXT_TOKENS } }],
        }),
        data: { maxContextTokens: RECOMMENDED_BUILD_CONTEXT_TOKENS },
      }),
    );
  });

  it("targets the operator override from PlatformConfig and raises DMR to it (e.g. 128k)", async () => {
    mockPrisma.platformConfig.findUnique.mockResolvedValue({ value: MAX_LOCAL_CONTEXT_TOKENS });
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
    const f = makeFetch({ configured: RECOMMENDED_BUILD_CONTEXT_TOKENS });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("raised");
    expect(r.before).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
    expect(r.after).toBe(MAX_LOCAL_CONTEXT_TOKENS);
    expect(f.calls.post).toBe(1);
    expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { maxContextTokens: MAX_LOCAL_CONTEXT_TOKENS } }),
    );
  });

  it("clamps an over-ceiling operator override down to MAX_LOCAL_CONTEXT_TOKENS", async () => {
    mockPrisma.platformConfig.findUnique.mockResolvedValue({ value: 999_999 });
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
    const f = makeFetch({ configured: null });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("raised");
    expect(r.after).toBe(MAX_LOCAL_CONTEXT_TOKENS);
  });

  it("repairs a drifted routing column when DMR already serves at/above target", async () => {
    // Override unset → target is the floor; DMR serves 49152 (re-profiling left the
    // ModelProfile column below that). No DMR POST, but the column is synced up.
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
    const f = makeFetch({ configured: 49_152 });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("ok");
    expect(r.before).toBe(49_152);
    expect(f.calls.post).toBe(0);
    expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { maxContextTokens: 49_152 } }),
    );
  });

  it("pins the runner resident when context is fine but DMR's 5-minute idle unload is in force (BI-34F71E9D)", async () => {
    // Live 2026-10-27: Config {"context-size":40960} only → 39 idle evictions,
    // each re-reading 17.66 GiB and discarding every slot's prompt cache.
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
    const f = makeFetch({ configured: 49_152, keepAlive: null });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("pinned");
    expect(r.before).toBe(49_152);
    expect(r.after).toBe(49_152);
    // The write keeps the larger served window; it never lowers it to the target.
    expect(f.calls.postBodies).toEqual([{ model: GEN, "context-size": 49_152, keep_alive: "-1" }]);
  });

  it("keeps stored runtime flags when re-pinning residency", async () => {
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
    const f = makeFetch({ configured: 49_152, keepAlive: null, extra: { "runtime-flags": ["--threads", "8"] } });
    await reconcileLocalModelContext(f.fetchImpl);
    expect(f.calls.postBodies).toEqual([
      { "runtime-flags": ["--threads", "8"], model: GEN, "context-size": 49_152, keep_alive: "-1" },
    ]);
  });

  it("raises context and pins residency in the same write", async () => {
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
    const f = makeFetch({ configured: 4096, keepAlive: null });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("raised");
    expect(f.calls.postBodies).toEqual([{ model: GEN, "context-size": RECOMMENDED_BUILD_CONTEXT_TOKENS, keep_alive: "-1" }]);
  });

  it("is write-free once context and residency are both in place", async () => {
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
    const f = makeFetch({ configured: RECOMMENDED_BUILD_CONTEXT_TOKENS, keepAlive: "-1" });
    expect((await reconcileLocalModelContext(f.fetchImpl)).status).toBe("ok");
    expect(f.calls.post).toBe(0);
  });

  describe("n-gram speculation (BI-0D208EBB)", () => {
    const QUALIFIED = "Running: llama.cpp b9879-cuda (sha256:57130b8a) 72874f5";
    const SPEC = ["--spec-type", "ngram-mod"];

    it("adds the speculation flags with context and residency on the qualified engine", async () => {
      mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
      const f = makeFetch({ configured: 40_960, engine: QUALIFIED });
      const r = await reconcileLocalModelContext(f.fetchImpl);
      expect(r.status).toBe("pinned");
      expect(f.calls.postBodies).toEqual([{ "runtime-flags": SPEC, model: GEN, "context-size": 40_960, keep_alive: "-1" }]);
    });

    it("is write-free once the qualified engine already carries them", async () => {
      mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
      const f = makeFetch({ configured: 40_960, engine: QUALIFIED, extra: { "runtime-flags": SPEC } });
      expect((await reconcileLocalModelContext(f.fetchImpl)).status).toBe("ok");
      expect(f.calls.post).toBe(0);
    });

    it("carries them on a context raise", async () => {
      mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
      const f = makeFetch({ configured: 4096, engine: QUALIFIED });
      await reconcileLocalModelContext(f.fetchImpl);
      expect(f.calls.postBodies[0]?.["runtime-flags"]).toEqual(SPEC);
    });

    it("never adds them on an engine that was not qualified", async () => {
      mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
      const f = makeFetch({ configured: 40_960 });
      expect((await reconcileLocalModelContext(f.fetchImpl)).status).toBe("ok");
      expect(f.calls.post).toBe(0);
    });

    it("removes them when the operator turns speculation off", async () => {
      mockPrisma.platformConfig.findUnique.mockImplementation(configByKey({ "local.speculativeDecoding": "off" }));
      mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
      const f = makeFetch({ configured: 40_960, engine: QUALIFIED, extra: { "runtime-flags": SPEC } });
      expect((await reconcileLocalModelContext(f.fetchImpl)).status).toBe("pinned");
      expect(f.calls.postBodies).toEqual([{ model: GEN, "context-size": 40_960, keep_alive: "-1" }]);
    });

    it("leaves operator-chosen runtime flags alone", async () => {
      mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
      const own = ["--spec-type", "ngram-simple"];
      const f = makeFetch({ configured: 40_960, engine: QUALIFIED, extra: { "runtime-flags": own } });
      expect((await reconcileLocalModelContext(f.fetchImpl)).status).toBe("ok");
      expect(f.calls.post).toBe(0);
    });
  });

  it("leaves the embedding model alone (no generation model installed)", async () => {
    const f = makeFetch({ models: [{ id: EMBED }], configured: null });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("no-model");
    expect(f.calls.post).toBe(0);
    expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
  });

  it("reports 'deferred' (not failure) when DMR refuses the write while a runner is active", async () => {
    const f = makeFetch({ configured: 4096, postStatus: 409 });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("deferred");
    expect(r.before).toBe(4096);
    expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
  });

  it("is best-effort when the local runtime is unreachable", async () => {
    const f = makeFetch({ modelsStatus: 503 });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("unreachable");
    expect(f.calls.post).toBe(0);
  });
});

describe("reconcileLocalEmbedderPlacement (BI-B60AFE7B)", () => {
  function embedRuntime(models: Array<{ id: string }>) {
    const posts: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("_configure")) {
        if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return { ok: true, status: 202, text: async () => "" } as unknown as Response; }
        return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ data: models }) } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, posts };
  }

  it("moves the installed embedder off the GPU, never the generation model", async () => {
    const r = embedRuntime([{ id: GEN }, { id: EMBED }]);
    expect(await reconcileLocalEmbedderPlacement(r.fetchImpl)).toMatchObject({ status: "applied", modelId: EMBED });
    expect(r.posts.every((p) => p.model === EMBED)).toBe(true);
  });

  it("is a no-op when no embedder is installed", async () => {
    const r = embedRuntime([{ id: GEN }]);
    expect((await reconcileLocalEmbedderPlacement(r.fetchImpl)).status).toBe("no-model");
    expect(r.posts).toEqual([]);
  });
});

function makeResolveFetch(opts: {
  models?: Array<{ id: string; dmr?: { context_window?: number } }>;
  override?: number | null;
  modelsStatus?: number;
}) {
  return (async (url: string) => {
    const u = String(url);
    if (u.includes("_configure")) {
      const entry = opts.override == null ? {} : { Config: { "context-size": opts.override } };
      return { ok: true, status: 200, json: async () => [entry] } as unknown as Response;
    }
    if (u.includes("/models")) {
      const status = opts.modelsStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ data: opts.models ?? [{ id: GEN, dmr: { context_window: 4096 } }] }),
      } as unknown as Response;
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
}

describe("resolveLocalServedContextTokens", () => {
  it("reads the requested model, never the first installed generation model", async () => {
    const selected = "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M";
    const f = vi.fn(makeResolveFetch({ models: [
      { id: GEN, dmr: { context_window: 4096 } },
      { id: selected, dmr: { context_window: 32768 } },
    ] }));
    expect(await resolveLocalServedContextTokens(f, { modelId: selected })).toBe(32768);
    expect(f.mock.calls.some(([url]) => String(url).includes(`model=${encodeURIComponent(selected)}`))).toBe(true);
  });

  it("does not borrow another installed model's capacity when the requested model is absent", async () => {
    const f = makeResolveFetch({ override: 40960 });
    expect(await resolveLocalServedContextTokens(f, { modelId: "ai/missing:latest" })).toBeNull();
  });

  it("fails closed when runtime configuration is unreadable even if a model card advertises capacity", async () => {
    const base = makeResolveFetch({ models: [{ id: GEN, dmr: { context_window: 262144 } }] });
    const f = (async (url: string, init?: RequestInit) => String(url).includes("_configure")
      ? new Response(null, { status: 503 }) : base(url, init)) as typeof fetch;
    expect(await resolveLocalServedContextTokens(f, { modelId: GEN })).toBeNull();
  });

  it("does not use the card default after an invalid explicit runtime override", async () => {
    const f = makeResolveFetch({ override: 0, models: [{ id: GEN, dmr: { context_window: 262144 } }] });
    expect(await resolveLocalServedContextTokens(f, { modelId: GEN })).toBeNull();
  });

  it("returns the DMR runtime override when one is set (the steady state)", async () => {
    const f = makeResolveFetch({ models: [{ id: GEN, dmr: { context_window: 4096 } }], override: 24_576 });
    expect(await resolveLocalServedContextTokens(f)).toBe(24_576);
  });

  it("falls back to the model-card default when no override is set (regressed state)", async () => {
    const f = makeResolveFetch({ models: [{ id: GEN, dmr: { context_window: 4096 } }], override: null });
    expect(await resolveLocalServedContextTokens(f)).toBe(4096);
  });

  it("returns null when only an embedding model is installed", async () => {
    const f = makeResolveFetch({ models: [{ id: EMBED, dmr: { context_window: 2048 } }], override: null });
    expect(await resolveLocalServedContextTokens(f)).toBeNull();
  });

  it("returns null (best-effort) when the models endpoint is unreachable", async () => {
    const f = makeResolveFetch({ modelsStatus: 503 });
    expect(await resolveLocalServedContextTokens(f)).toBeNull();
  });
});

describe("resolveLocalServingPosture (BI-A8BFEFCE)", () => {
  beforeEach(() => {
    mockPrisma.modelProfile.findMany.mockReset();
  });

  it("reports present with the served window when the probe answers", async () => {
    const f = makeResolveFetch({ models: [{ id: GEN, dmr: { context_window: 4096 } }], override: 24_576 });
    expect(await resolveLocalServingPosture(f)).toEqual({
      servedContextTokens: 24_576,
      presence: "present",
    });
    // The probe was authoritative — no need to consult the routing store.
    expect(mockPrisma.modelProfile.findMany).not.toHaveBeenCalled();
  });

  it("reports absent when the probe answers cleanly with no generation model", async () => {
    // A clean list holding only an embedder is a POSITIVE finding of absence.
    const f = makeResolveFetch({ models: [{ id: EMBED, dmr: { context_window: 2048 } }], override: null });
    expect(await resolveLocalServingPosture(f)).toEqual({
      servedContextTokens: null,
      presence: "absent",
    });
    expect(mockPrisma.modelProfile.findMany).not.toHaveBeenCalled();
  });

  it("recovers presence from ModelProfile when the probe is unreachable", async () => {
    // The reported incident: a momentarily unreachable DMR read as a cloud-only
    // install, which lifted the tool cap to 48 and disqualified local fallback.
    mockPrisma.modelProfile.findMany.mockResolvedValue([{ modelId: GEN }]);
    const f = makeResolveFetch({ modelsStatus: 503 });
    expect(await resolveLocalServingPosture(f)).toEqual({
      servedContextTokens: null,
      presence: "present",
    });
  });

  it("reports absent when the probe is unreachable and no local profile is active", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([]);
    const f = makeResolveFetch({ modelsStatus: 503 });
    expect(await resolveLocalServingPosture(f)).toEqual({
      servedContextTokens: null,
      presence: "absent",
    });
  });

  it("ignores an embedding-only ModelProfile set on the recovery path", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([{ modelId: EMBED }]);
    const f = makeResolveFetch({ modelsStatus: 503 });
    expect((await resolveLocalServingPosture(f)).presence).toBe("absent");
  });

  it("fails SAFE to unknown when both the probe and the profile read fail", async () => {
    // Unknown must behave like present downstream — never like absent, which is
    // what silently removed local from the fallback chain.
    mockPrisma.modelProfile.findMany.mockRejectedValue(new Error("db down"));
    const f = makeResolveFetch({ modelsStatus: 503 });
    expect(await resolveLocalServingPosture(f)).toEqual({
      servedContextTokens: null,
      presence: "unknown",
    });
  });
});

describe("operator pause during local configuration reconciliation", () => {
  it.each([
    { configured: null },
    { configured: 40960, keepAlive: "5m" },
  ])("defers context/residency repair without reporting a change: %j", async opts => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status: "paused" });
    const r = makeFetch(opts);
    expect(await reconcileLocalModelContext(r.fetchImpl)).toMatchObject({
      status: "deferred", after: null, reason: expect.stringMatching(/paused by an operator/),
    });
    expect(r.calls.post).toBe(0);
    expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
  });

  it("defers embedder placement without preloading it", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status: "paused" });
    const r = makeFetch({ models: [{ id: EMBED }] });
    expect(await reconcileLocalEmbedderPlacement(r.fetchImpl)).toMatchObject({
      status: "deferred", reason: expect.stringMatching(/paused by an operator/),
    });
    expect(r.calls.post).toBe(0);
  });
});
