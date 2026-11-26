import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ auth: vi.fn(), propose: vi.fn(), producer: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: fixture.auth }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/workroom-runtime/s5-rehearsal-approval-producer.server", () => ({
  s5RehearsalPreviewOwnerPorts: () => ({}), createS5RehearsalApprovalProducer: fixture.producer,
}));

import { POST } from "./route";

const origin = "http://localhost:3001";
const lookup = { workroomId: "WC-FIXTURE", sessionRef: "run-a", stageKey: "coordinate", stageAttemptRef: "attempt-a", reviewedPinDigest: "a".repeat(64) };
const request = (originHeader = origin, extra = "") => new Request(
  `${origin}/api/internal/s5-rehearsal-admission/request-approval?${new URLSearchParams(lookup)}${extra}`,
  { method: "POST", headers: { Origin: originHeader } },
);

beforeEach(() => {
  vi.stubEnv("DPF_ENVIRONMENT", "dev");
  vi.stubEnv("DPF_ENVIRONMENT_CLASS", "development");
  vi.stubEnv("DPF_PREVIEW_SOURCE_SHA", "b".repeat(40));
  vi.stubEnv("DPF_PREVIEW_LEASE_ID", "NPEL-fixture");
  vi.stubEnv("DATABASE_URL", "postgresql://dev-postgres:5432/dpf");
  fixture.auth.mockReset().mockResolvedValue({ user: { id: "owner" } });
  fixture.propose.mockReset().mockResolvedValue({ kind: "proposed", envelopeId: "envelope-fixture", permitRef: "GPM-fixture", expiresAt: 1 });
  fixture.producer.mockReset().mockReturnValue(fixture.propose);
});
afterEach(() => vi.unstubAllEnvs());

describe("S5 rehearsal approval request route", () => {
  it("opens only the ordinary exact Inbox card for the preview session owner", async () => {
    const reply = await POST(request());
    expect(reply.status).toBe(200);
    expect(reply.headers.get("cache-control")).toBe("no-store");
    expect(await reply.json()).toMatchObject({ kind: "proposed", inboxHref: expect.stringContaining("/workspace/inbox?approval=envelope-fixture") });
    expect(fixture.propose).toHaveBeenCalledExactlyOnceWith("owner", lookup);
  });

  it("never reaches the producer outside the pinned non-production preview or without same-origin owner authentication", async () => {
    expect((await POST(request("https://foreign.invalid"))).status).toBe(404);
    expect((await POST(request(origin, "&workroomId=WC-DUPLICATE"))).status).toBe(404);
    fixture.auth.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:5432/dpf");
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv("DATABASE_URL", "postgresql://dev-postgres:5432/dpf");
    vi.stubEnv("DPF_ENVIRONMENT_CLASS", "production");
    expect((await POST(request())).status).toBe(404);
    expect(fixture.producer).not.toHaveBeenCalled();
  });
});
