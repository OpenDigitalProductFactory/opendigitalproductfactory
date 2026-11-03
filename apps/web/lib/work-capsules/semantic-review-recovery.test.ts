import { beforeEach, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  db: { taskRun: { findFirst: vi.fn() }, taskNode: { findMany: vi.fn() }, runtimeVerification: { findFirst: vi.fn() } },
  request: vi.fn(), inspect: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: fixtures.db }));
vi.mock("@/lib/change-review/semantic-review-request-store", () => ({ readPersistedSemanticReviewRequest: fixtures.request }));
vi.mock("@/lib/change-review/semantic-review-authority", () => ({ inspectSemanticReviewAuthority: fixtures.inspect }));
import { readOwnedRoomReview } from "./semantic-review-recovery";

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.db.taskNode.findMany.mockResolvedValue([]);
  fixtures.db.runtimeVerification.findFirst.mockResolvedValue(null);
});

it("preserves the internal task identity through the real recovery reader to authority diagnosis", async () => {
  const row = { id: "internal-row", taskRunId: "TR-OWN", userId: "owner", status: "input-required",
    updatedAt: new Date(), a2aMetadata: { gateKind: "semantic-review", capsuleId: "WC-OWN" }, progressPayload: {} };
  // Model Prisma's projection: unselected fields must not reach the shared reader.
  fixtures.db.taskRun.findFirst.mockImplementation(async ({ select }) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => select[key])));
  const packet = { actor: { apiTokenId: "private-token-reference" } };
  fixtures.request.mockResolvedValue(packet);
  fixtures.inspect.mockResolvedValue({ state: "denied", reason: "oauth-authority-invalid", detail: "continuity-evidence-missing" });

  const result = await readOwnedRoomReview("WC-OWN", "TR-OWN", "owner");

  expect(result?.recovery.details.authority).toMatchObject({ state: "denied", reason: "oauth-authority-invalid",
    detail: "continuity-evidence-missing" });
  expect(fixtures.request).toHaveBeenCalledWith(expect.objectContaining({ id: "internal-row", taskRunId: "TR-OWN", userId: "owner" }));
  expect(fixtures.inspect).toHaveBeenCalledWith(packet, "TR-OWN");
  expect(result?.recovery.details.remediation).toMatchObject({ executionSettled: false, retryAuthorized: false });
  expect(JSON.stringify(result)).not.toContain("internal-row");
  expect(JSON.stringify(result)).not.toContain("private-token-reference");
});
