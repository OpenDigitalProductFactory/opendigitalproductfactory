import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  fetch: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/lib/network/off-threadpool-fetch", () => ({
  createOffThreadpoolFetchTransport: mocks.createTransport,
}));

describe("provider inference transport", () => {
  it("owns one process-lived off-threadpool fetch transport", async () => {
    mocks.createTransport.mockReturnValue({
      fetch: mocks.fetch,
      close: mocks.close,
    });

    const { providerInferenceFetch } = await import("./provider-inference-transport");

    expect(mocks.createTransport).toHaveBeenCalledOnce();
    expect(providerInferenceFetch).toBe(mocks.fetch);
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
