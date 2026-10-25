import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@dpf/db", () => ({ prisma: {}, DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY" }));
import * as profiles from "@/lib/work-management/room-review-profile";
import { listWorkCapsulesTool } from "./mcp-handlers";

const context = { userContext: { platformRole: "HR-000", isSuperuser: true } };
const call = (params: Record<string, unknown> = {}) => listWorkCapsulesTool({ view: "definitions", ...params }, "reader", context);
beforeEach(() => vi.restoreAllMocks());

it.each([0, -1, 101, 1.5, "5", null])("refuses invalid page limit %s", async limit => {
  expect(await call({ limit })).toMatchObject({ success: false, error: "invalid_page_input" });
});

it.each([null, 5, "", "x".repeat(1025)])("refuses malformed cursor %s", async cursor => {
  expect(await call({ cursor })).toMatchObject({ success: false });
});

it.each(["unsupported", "unresolved"] as const)("reports %s composition without implying assessed coverage", async status => {
  const original = profiles.composeRoomReviewProfile("booking", []);
  vi.spyOn(profiles, "composeRoomReviewProfile").mockReturnValue({ ...original, status, fingerprint: null });
  const result = await call({ limit: 1 });
  expect(result).toMatchObject({ success: true, data: {
    occurrenceAssessment: "not-exercised", organizationApplicability: "unknown",
    definitions: [expect.objectContaining({ assessment: "not-exercised", profile: { status, fingerprint: null } })],
    page: { compositionCounts: { [status]: 1 } },
  } });
  expect(result.data).not.toHaveProperty("passCount");
});

it("refuses an oversized single definition without advancing the caller's cursor", async () => {
  const inventory = profiles.listRoomReviewDefinitions({ limit: 1 });
  const cursor = `workroom-definitions:v1:${inventory.nextCursor}`;
  vi.spyOn(profiles, "listRoomReviewDefinitions").mockReturnValue({ ...inventory,
    items: [{ ...inventory.items[0]!, aliases: ["x".repeat(5000)] }] });
  const result = await call({ cursor, limit: 1 });
  expect(result).toMatchObject({ success: false, error: "definition_page_budget_exceeded",
    data: { recovery: { toolName: "list_workrooms", arguments: { view: "definitions", limit: 1, cursor } } } });
  expect(result.data).not.toHaveProperty("definitions");
  expect(result.data).not.toHaveProperty("nextCursor");
});

it("does not leak an internal registry error or return partial inventory", async () => {
  vi.spyOn(profiles, "listRoomReviewDefinitions").mockImplementation(() => { throw new Error("private diagnostic"); });
  const result = await call();
  expect(result).toMatchObject({ success: false, error: "definition_inventory_unavailable" });
  expect(JSON.stringify(result)).not.toContain("private diagnostic");
  expect(result.data).not.toHaveProperty("definitions");
});
