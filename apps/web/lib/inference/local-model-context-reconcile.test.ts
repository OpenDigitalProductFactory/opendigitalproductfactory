import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    modelProfile: { updateMany: vi.fn(), findMany: vi.fn() },
    platformConfig: { findUnique: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma, DISCOVERY_TRIAGE_AGENT_ID: "discovery-triage" }));

import {
  reconcileLocalModelContext,
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
beforeEach(() => mockPrisma.platformConfig.findUnique.mockResolvedValue(null));
afterEach(() => vi.clearAllMocks());

const GEN = "docker.io/ai/qwen3-coder:latest";
const EMBED = "docker.io/ai/nomic-embed-text-v1.5:latest";

// A stateful DMR fetch double. `configured` is the current `_configure` override
// the GET reports (null = unset); a successful POST flips it to the requested
// value, mirroring DMR's read-back-after-write contract.
function makeFetch(opts: {
  models?: Array<{ id: string }>;
  configured?: number | null;
  postStatus?: number;
  modelsStatus?: number;
}) {
  let configured = opts.configured ?? null;
  const calls = { post: 0, getConfigure: 0, models: 0 };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("_configure")) {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST") {
        calls.post++;
        const status = opts.postStatus ?? 202;
        const ok = status >= 200 && status < 300;
        if (ok) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { "context-size"?: number };
          configured = body["context-size"] ?? configured;
        }
        return { ok, status, text: async () => "", json: async () => [{ Config: { "context-size": configured } }] } as unknown as Response;
      }
      calls.getConfigure++;
      const entry = configured == null ? {} : { Config: { "context-size": configured } };
      return { ok: true, status: 200, json: async () => [entry] } as unknown as Response;
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
