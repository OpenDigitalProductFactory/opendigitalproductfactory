import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), save: vi.fn(), choices: vi.fn(), refresh: vi.fn() }));
vi.mock("./shared/guards", () => ({ requireUserId: m.user }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("@/lib/work-management/workroom-assistant-invitation", () => ({
  inviteWorkroomAssistant: m.save, listWorkroomAssistantChoices: m.choices,
  WorkroomAssistantInvitationError: class extends Error {},
}));
import { getWorkroomAssistantChoices, saveWorkroomAssistantInvitation } from "./workroom-assistant-invitation";
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue("session-human"); });
it("takes identity from the session for both read and mutation", async () => {
  m.choices.mockResolvedValue([]); m.save.mockResolvedValue({ role: "observer" });
  await getWorkroomAssistantChoices("selected-room");
  const input = { workroomId: "selected-room", agentId: "codex", role: "observer" as const };
  expect(await saveWorkroomAssistantInvitation(input)).toEqual({ ok: true, data: { role: "observer" } });
  expect(m.choices).toHaveBeenCalledWith("session-human", "selected-room");
  expect(m.save).toHaveBeenCalledWith("session-human", input);
});
it("requires a session and hides internal error details", async () => {
  m.user.mockRejectedValue(new Error("Unauthorized"));
  await expect(getWorkroomAssistantChoices("room")).rejects.toThrow("Unauthorized");
  expect(m.choices).not.toHaveBeenCalled();
  m.user.mockResolvedValue("session-human"); m.choices.mockRejectedValue(new Error("private DB detail"));
  expect(JSON.stringify(await getWorkroomAssistantChoices("room"))).not.toContain("private DB");
});
