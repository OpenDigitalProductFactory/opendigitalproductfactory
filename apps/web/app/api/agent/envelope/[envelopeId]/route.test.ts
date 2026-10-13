import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/coworker/approval-outcome-store", () => ({ loadApprovalOutcomes: m.load }));

import { GET } from "./route";

const call = (envelopeId = "env-1") => GET(new Request("http://x"), { params: Promise.resolve({ envelopeId }) });

beforeEach(() => vi.resetAllMocks());

it("refuses an anonymous reader", async () => {
  m.auth.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  expect(m.load).not.toHaveBeenCalled();
});

it("reads only the signed-in person's own request, through the Inbox projection", async () => {
  m.auth.mockResolvedValue({ user: { id: "alice" } });
  m.load.mockResolvedValue([{ envelopeId: "env-1", state: "waiting" }]);
  const response = await call();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ outcome: { envelopeId: "env-1", state: "waiting" } });
  expect(m.load).toHaveBeenCalledWith("alice", "env-1");
});

it("answers 404 for a request that is not this person's", async () => {
  m.auth.mockResolvedValue({ user: { id: "bob" } });
  m.load.mockResolvedValue([]);
  expect((await call()).status).toBe(404);
});
