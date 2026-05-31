import { afterEach, describe, expect, it, vi } from "vitest";
import { DpfClient } from "./client";

function makeClient(token: string | null = "tok") {
  return new DpfClient({
    baseUrl: "https://api.example.test",
    getToken: async () => token,
  });
}

function mockFetch(status = 200, body: unknown = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function headersFrom(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  return fetchMock.mock.calls[0][1].headers as Record<string, string>;
}

describe("DpfClient request headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sets JSON content-type for non-FormData bodies", async () => {
    const fetchMock = mockFetch();
    await makeClient().post("/things", { a: 1 });

    const headers = headersFrom(fetchMock);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("does NOT set a JSON content-type for FormData uploads", async () => {
    const fetchMock = mockFetch();
    const form = new FormData();
    form.append("file", new Blob(["data"]), "scan.pdf");

    await makeClient().upload("/uploads", form);

    const headers = headersFrom(fetchMock);
    // The runtime must own Content-Type so it can append the multipart boundary.
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("still attaches the bearer token on FormData uploads", async () => {
    const fetchMock = mockFetch();
    await makeClient("abc123").upload("/uploads", new FormData());

    const headers = headersFrom(fetchMock);
    expect(headers["Authorization"]).toBe("Bearer abc123");
  });
});
