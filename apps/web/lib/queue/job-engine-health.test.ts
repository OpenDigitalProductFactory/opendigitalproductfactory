import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      upsert: (...a: unknown[]) => upsertMock(...a),
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
    },
  },
}));

import {
  INNGEST_REGISTRATION_CONFIG_KEY,
  classifyJobEngineHealth,
  getJobEngineHealth,
  recordInngestRegistration,
} from "./job-engine-health";

beforeEach(() => {
  upsertMock.mockReset().mockResolvedValue({});
  findUniqueMock.mockReset();
});

describe("classifyJobEngineHealth", () => {
  it("is unknown when there is no record yet (don't alarm a fresh install)", () => {
    expect(classifyJobEngineHealth(null)).toMatchObject({ status: "unknown" });
  });
  it("is healthy when the last registration succeeded", () => {
    expect(
      classifyJobEngineHealth({ ok: true, at: "2026-06-15T00:00:00.000Z", error: null }),
    ).toMatchObject({ status: "healthy", checkedAt: "2026-06-15T00:00:00.000Z" });
  });
  it("is degraded with the error when the last registration failed", () => {
    expect(
      classifyJobEngineHealth({ ok: false, at: "2026-06-15T00:00:00.000Z", error: "HTTP 500" }),
    ).toMatchObject({ status: "degraded", detail: "HTTP 500" });
  });
});

describe("recordInngestRegistration", () => {
  it("persists ok=true with no error on success", async () => {
    await recordInngestRegistration(true, null, new Date("2026-06-15T00:00:00.000Z"));
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: INNGEST_REGISTRATION_CONFIG_KEY },
        update: expect.objectContaining({
          value: { ok: true, at: "2026-06-15T00:00:00.000Z", error: null },
        }),
      }),
    );
  });
  it("persists ok=false with the error on failure", async () => {
    await recordInngestRegistration(false, "HTTP 500", new Date("2026-06-15T00:00:00.000Z"));
    expect(upsertMock.mock.calls[0][0].update.value).toEqual({
      ok: false,
      at: "2026-06-15T00:00:00.000Z",
      error: "HTTP 500",
    });
  });
  it("never throws when the DB write fails (boot-path safety)", async () => {
    upsertMock.mockRejectedValueOnce(new Error("db down"));
    await expect(recordInngestRegistration(true)).resolves.toBeUndefined();
  });
});

describe("getJobEngineHealth", () => {
  it("reads and classifies the persisted state", async () => {
    findUniqueMock.mockResolvedValueOnce({
      value: { ok: false, at: "2026-06-15T00:00:00.000Z", error: "HTTP 500" },
    });
    expect(await getJobEngineHealth()).toMatchObject({
      status: "degraded",
      detail: "HTTP 500",
    });
  });
  it("returns unknown when absent or on read error", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    expect(await getJobEngineHealth()).toMatchObject({ status: "unknown" });
    findUniqueMock.mockRejectedValueOnce(new Error("db down"));
    expect(await getJobEngineHealth()).toMatchObject({ status: "unknown" });
  });
});
