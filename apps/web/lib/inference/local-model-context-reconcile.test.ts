import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { modelProfile: { updateMany: vi.fn() } },
}));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma, DISCOVERY_TRIAGE_AGENT_ID: "discovery-triage" }));

import { reconcileLocalModelContext, resolveLocalServedContextTokens } from "./local-model-context-reconcile";
import { RECOMMENDED_BUILD_CONTEXT_TOKENS } from "./local-model-policy";

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

  it("is a no-op when already at/above target — no POST, no DB write", async () => {
    const f = makeFetch({ configured: RECOMMENDED_BUILD_CONTEXT_TOKENS });
    const r = await reconcileLocalModelContext(f.fetchImpl);
    expect(r.status).toBe("ok");
    expect(r.before).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
    expect(f.calls.post).toBe(0);
    expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
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
