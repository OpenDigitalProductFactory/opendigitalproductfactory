import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock("./shared/guards", () => ({ requireUserId: mocks.user }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/identity/coworker-data-access", async (original) => ({
  ...await original<typeof import("@/lib/identity/coworker-data-access")>(), setCoworkerDataAccess: mocks.save,
}));
import { updateCoworkerDataAccess } from "./coworker-data-access";
import { CoworkerDataAccessError } from "@/lib/identity/coworker-data-access";
const input = { agentId: "AGT-EXT-CODEX", levels: ["public"], expected: ["public", "internal"], reason: "Remove internal access" };
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue("signed-in-human"); });
it("takes the human from the session and refreshes the settings only after success", async () => {
  mocks.save.mockResolvedValue({ levels: ["public"] });
  expect(await updateCoworkerDataAccess(input)).toEqual({ ok: true, data: { levels: ["public"] } });
  expect(mocks.save).toHaveBeenCalledWith("signed-in-human", input);
  expect(mocks.revalidate).toHaveBeenCalledWith("/platform/identity/agents");
});
it("rejects an unauthenticated caller before invoking the writer", async () => {
  mocks.user.mockRejectedValue(new Error("Unauthorized"));
  await expect(updateCoworkerDataAccess(input)).rejects.toThrow("Unauthorized");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("returns actionable policy feedback but does not expose database errors", async () => {
  mocks.save.mockRejectedValue(new CoworkerDataAccessError("Refresh and review the changed access."));
  expect(await updateCoworkerDataAccess(input)).toEqual({ ok: false, error: "Refresh and review the changed access." });
  mocks.save.mockRejectedValue(new Error("private database detail"));
  expect(JSON.stringify(await updateCoworkerDataAccess(input))).not.toContain("private database");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
