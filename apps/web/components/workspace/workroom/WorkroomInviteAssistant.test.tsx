// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const m = vi.hoisted(() => ({ choices: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/workroom-assistant-invitation", () => ({ getWorkroomAssistantChoices: m.choices, saveWorkroomAssistantInvitation: m.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
import { WorkroomInviteAssistant } from "./WorkroomInviteAssistant";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("shows the existing contributor choice without downgrading on reopen", async () => {
  m.choices.mockResolvedValue({ ok: true, data: [{ agentId: "codex", name: "Codex", role: "contributor" }] });
  render(<WorkroomInviteAssistant workroomId="room-one" />);
  fireEvent.click(screen.getByText("Assistant access"));
  await screen.findByLabelText("Access");
  expect((screen.getByLabelText("Access") as HTMLSelectElement).value).toBe("contributor");
});
it("loads approved choices on demand and saves only the selected room", async () => {
  m.choices.mockResolvedValue({ ok: true, data: [{ agentId: "codex", name: "Codex" }] });
  m.save.mockResolvedValue({ ok: true });
  render(<WorkroomInviteAssistant workroomId="room-one" />);
  expect(m.choices).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Assistant access"));
  await screen.findByLabelText("Assistant");
  expect(m.choices).toHaveBeenCalledWith("room-one");
  fireEvent.change(screen.getByLabelText("Access"), { target: { value: "contributor" } });
  fireEvent.submit(screen.getByText("Save room access").closest("form")!);
  await waitFor(() => expect(m.save).toHaveBeenCalledWith({ workroomId: "room-one", agentId: "codex", role: "contributor" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("without signing in again"));
});
it("explains denied or unavailable setup without asking for repeated authentication", async () => {
  m.choices.mockResolvedValue({ ok: false, error: "Only the room owner can invite an assistant." });
  const view = render(<WorkroomInviteAssistant workroomId="room-one" />);
  fireEvent.click(screen.getByText("Assistant access"));
  await screen.findByText("Only the room owner can invite an assistant.");
  expect(screen.queryByText("Save room access")).toBeNull();
  view.rerender(<WorkroomInviteAssistant workroomId="room-two" />);
  expect(screen.queryByText("Only the room owner can invite an assistant.")).toBeNull();
  m.choices.mockRejectedValue(new Error("network"));
  fireEvent.click(screen.getByText("Assistant access"));
  await screen.findByText("Could not load access. Try again.");
});
