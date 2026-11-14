import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  queryRaw: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({
  prisma: { $queryRaw: mocks.queryRaw, organization: { findMany: mocks.findMany } },
}));

import { GET } from "./route";

// BI-2F7BE778: GET /api/wiki/link-suggest — the editor's `[[` suggestions.

function request(query: string) {
  return new Request(`http://localhost/api/wiki/link-suggest?${query}`);
}

describe("GET /api/wiki/link-suggest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.findMany.mockResolvedValue([{ id: "org_acme" }]);
    mocks.queryRaw.mockResolvedValue([
      { id: "k1", slug: "entities/budget", title: "Budget", pageKind: "entity", organizationId: null, isKernel: true, kernelPageId: null },
      { id: "o1", slug: "entities/budget-policy", title: "Budget policy", pageKind: "summary", organizationId: "org_acme", isKernel: false, kernelPageId: null },
    ]);
  });

  it("refuses without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await GET(request("q=bu&from=entities/x"));
    expect(res.status).toBe(401);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns nothing below two characters, without querying", async () => {
    const res = await GET(request("q=b&from=entities/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [] });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns readable suggestions for an organization page, with a Server-Timing header", async () => {
    const res = await GET(request("q=bud&from=entities/x"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toMatch(/^suggest;dur=\d+(\.\d+)?$/);
    const body = (await res.json()) as { suggestions: Array<{ slug: string; scope: string }> };
    expect(body.suggestions.map((s) => s.slug)).toEqual(["entities/budget", "entities/budget-policy"]);
  });

  it("never offers organization pages when editing at a profession slug", async () => {
    const res = await GET(request("q=bud&from=professions/finance/close"));
    const body = (await res.json()) as { suggestions: Array<{ slug: string }> };
    expect(body.suggestions.map((s) => s.slug)).toEqual(["entities/budget"]);
    const [, ...values] = mocks.queryRaw.mock.calls[0]! as unknown[];
    expect(values).not.toContain("org_acme");
  });

  it("offers no organization page on an install with several organizations (reader seam fails closed)", async () => {
    mocks.findMany.mockResolvedValue([{ id: "org_a" }, { id: "org_b" }]);
    const res = await GET(request("q=bud&from=entities/x"));
    const body = (await res.json()) as { suggestions: Array<{ slug: string }> };
    expect(body.suggestions.map((s) => s.slug)).toEqual(["entities/budget"]);
  });
});
