import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { upsert: mockUpsert } },
}));

// encryptJson runs for real (no env key = plaintext JSON) — no mock needed.
import { connectGreenhouse } from "./connect-action";

function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
}

describe("connectGreenhouse", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
  });

  it("returns ok:true and upserts a connected row on a valid key", async () => {
    const result = await connectGreenhouse({ apiToken: "good-key" }, { fetchImpl: okFetch() });

    expect(result).toEqual({ ok: true, status: "connected" });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("greenhouse-recruiting");
    expect(call.create.provider).toBe("greenhouse");
    expect(call.create.status).toBe("connected");
    expect(call.create.fieldsEnc).toBeTypeOf("string");
  });

  it("rejects with 400 and does NOT persist on empty token", async () => {
    const result = await connectGreenhouse({ apiToken: "" }, { fetchImpl: okFetch() });

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("persists status=error and a redacted message on a 401, never leaking the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

    const result = await connectGreenhouse(
      { apiToken: "leaky-secret-key-do-not-log" },
      { fetchImpl },
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    if (!result.ok) {
      expect(result.error).toMatch(/invalid Harvest API key/i);
      expect(result.error).not.toContain("leaky-secret-key-do-not-log");
    }
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe("error");
    expect(call.create.lastErrorMsg).not.toContain("leaky-secret-key-do-not-log");
  });

  it("persists status=error when the Harvest API is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await connectGreenhouse({ apiToken: "good-key" }, { fetchImpl });

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    if (!result.ok) {
      expect(result.error).not.toContain("network down");
    }
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].create.status).toBe("error");
  });
});
