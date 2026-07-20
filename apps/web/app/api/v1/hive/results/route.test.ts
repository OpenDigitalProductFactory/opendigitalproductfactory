import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockPersist } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockPersist: vi.fn(),
}));

vi.mock("@/lib/auth/federation-link-token", () => ({ resolveFederationLinkAuth: mockResolveAuth }));
vi.mock("@/lib/hive/result-store", () => ({ persistHiveResult: mockPersist }));

import { POST } from "./route";

function request(body: unknown = { schemaVersion: "dpf.hive-result/1" }): NextRequest {
  return new Request("http://test/api/v1/hive/results", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer dpflink_test" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "channel-upstream" });
  mockPersist.mockResolvedValue({ ok: true, action: "created", id: "ledger_1" });
});

describe("POST /api/v1/hive/results", () => {
  it("requires a trusted founder-facing channel", async () => {
    mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "managed-by" });
    expect((await POST(request())).status).toBe(403);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("persists before acknowledging and makes receipt retries idempotent", async () => {
    const body = { schemaVersion: "dpf.hive-result/1", sourceReceipt: "receipt_opaque" };
    const created = await POST(request(body));
    expect(created.status).toBe(202);
    expect(mockPersist).toHaveBeenCalledWith(body);

    mockPersist.mockResolvedValue({ ok: true, action: "noop", id: "ledger_1" });
    expect((await POST(request(body))).status).toBe(200);
  });

  it("does not persist a projection rejected by the result-only guard", async () => {
    mockPersist.mockResolvedValue({ ok: false, violations: ["forbidden-field:result.backlog"] });
    const response = await POST(request({ backlog: "private" }));
    expect(response.status).toBe(422);
  });
});
