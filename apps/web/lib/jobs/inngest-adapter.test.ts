import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  fetch: vi.fn(async () => new Response("ok")),
}));

vi.mock("@/lib/network/off-threadpool-fetch", () => ({
  createOffThreadpoolFetchTransport: () => ({
    close: mocks.close,
    fetch: mocks.fetch,
  }),
}));

import { inngestClient } from "./inngest-adapter";

describe("inngest client transport", () => {
  it("uses the process-lived off-threadpool fetch for SDK network calls", async () => {
    const clientFetch = (inngestClient as unknown as { fetch: typeof fetch }).fetch;

    await expect(clientFetch("http://inngest:8288/health")).resolves.toBeInstanceOf(Response);
    expect(mocks.fetch).toHaveBeenCalledWith("http://inngest:8288/health");
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
