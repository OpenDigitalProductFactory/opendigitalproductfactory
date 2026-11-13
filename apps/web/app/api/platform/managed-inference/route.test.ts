import { expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createManagedInferenceRequestId } from "@/lib/remote-action/managed-inference-request";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), can: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@/lib/remote-action/managed-inference-request-state", () => ({ readManagedInferenceRequestState: mocks.read }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "operator" } }); mocks.can.mockReturnValue(true); });
it("requires the operator capability before any request observation", async () => {
  mocks.can.mockReturnValue(false);
  expect((await GET(new NextRequest("https://localhost/api/platform/managed-inference"))).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("refuses an arbitrary path or malformed identity", async () => {
  expect((await GET(new NextRequest("https://localhost/api/platform/managed-inference?requestId=../other"))).status).toBe(422);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("observes only the original request without queueing or replaying a host effect", async () => {
  const requestId = createManagedInferenceRequestId();
  mocks.read.mockResolvedValue({ requestId, state: "unknown", canSubmitNewRequest: false, message: "Keep the original request." });
  const response = await GET(new NextRequest(`https://localhost/api/platform/managed-inference?requestId=${requestId}`));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.read).toHaveBeenCalledWith({ requestId });
  expect((await response.json()).observation.canSubmitNewRequest).toBe(false);
});
