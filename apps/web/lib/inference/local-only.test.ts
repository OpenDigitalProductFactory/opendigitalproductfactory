import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { platformConfig: db } }));

import { getLocalOnlyInference, getLocalOnlyInferenceFresh, invalidateLocalOnlyInferenceCache, setLocalOnlyInference } from "./local-only";

beforeEach(() => {
  vi.resetAllMocks();
  invalidateLocalOnlyInferenceCache();
});

describe("local-only policy", () => {
  it("does not grant cloud permission when the first read fails", async () => {
    db.findUnique.mockRejectedValue(new Error("policy unavailable"));
    await expect(getLocalOnlyInference(100)).rejects.toThrow("policy unavailable");
  });

  it.each([true, false])("does not reuse expired %s policy when refresh fails", async (enabled) => {
    db.findUnique.mockResolvedValueOnce({ value: { enabled } });
    expect(await getLocalOnlyInference(100)).toBe(enabled);
    db.findUnique.mockRejectedValueOnce(new Error("policy unavailable"));
    await expect(getLocalOnlyInference(5100)).rejects.toThrow("policy unavailable");
    db.findUnique.mockResolvedValueOnce({ value: { enabled: true } });
    expect(await getLocalOnlyInference(5101)).toBe(true);
  });

  it("retains the established missing-row default", async () => {
    db.findUnique.mockResolvedValue(null);
    expect(await getLocalOnlyInference()).toBe(false);
  });

  it.each([true, false])("caches a valid %s policy for less than five seconds", async (enabled) => {
    db.findUnique.mockResolvedValue({ value: { enabled } });
    expect(await getLocalOnlyInference(100)).toBe(enabled);
    expect(await getLocalOnlyInference(5099)).toBe(enabled);
    expect(db.findUnique).toHaveBeenCalledTimes(1);
    await getLocalOnlyInference(5100);
    expect(db.findUnique).toHaveBeenCalledTimes(2);
  });

  it("fresh dispatch reads bypass and replace the cache", async () => {
    db.findUnique.mockResolvedValueOnce({ value: { enabled: false } });
    await getLocalOnlyInference(100);
    db.findUnique.mockResolvedValueOnce({ value: { enabled: true } });
    expect(await getLocalOnlyInferenceFresh(101)).toBe(true);
    expect(await getLocalOnlyInference(102)).toBe(true);
    expect(db.findUnique).toHaveBeenCalledTimes(2);
  });

  it("fresh read failure rejects even with a permissive cache", async () => {
    db.findUnique.mockResolvedValueOnce({ value: { enabled: false } });
    await getLocalOnlyInference(100);
    db.findUnique.mockRejectedValueOnce(new Error("policy unavailable"));
    await expect(getLocalOnlyInferenceFresh(101)).rejects.toThrow("policy unavailable");
    db.findUnique.mockRejectedValueOnce(new Error("still unavailable"));
    await expect(getLocalOnlyInference(102)).rejects.toThrow("still unavailable");
  });

  it("successful writes invalidate the cache and preserve the existing key", async () => {
    db.findUnique.mockResolvedValueOnce({ value: { enabled: false } });
    await getLocalOnlyInference(100);
    await setLocalOnlyInference(true);
    expect(db.upsert).toHaveBeenCalledWith({ where: { key: "inference-local-only" }, update: { value: { enabled: true } }, create: { key: "inference-local-only", value: { enabled: true } } });
    db.findUnique.mockResolvedValueOnce({ value: { enabled: true } });
    expect(await getLocalOnlyInference(101)).toBe(true);
  });
});
