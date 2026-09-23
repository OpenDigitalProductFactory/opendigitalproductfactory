// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/coworker-data-access", () => ({ updateCoworkerDataAccess: save }));
import { CoworkerDataAccess } from "./CoworkerDataAccess";
import { CoworkerDataAccessSettings } from "./CoworkerDataAccessSettings";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("can remove an existing level above the administrator's current access", () => {
  render(<CoworkerDataAccess agentId="codex" current={["public", "internal"]} allowed={["public"]} />);
  const internal = screen.getByLabelText(/internal/) as HTMLInputElement;
  expect(internal.disabled).toBe(false);
  fireEvent.click(internal);
  expect(internal.checked).toBe(false);
  expect(internal.disabled).toBe(true);
});
it("shows the current restriction without an edit form to nonadministrators", () => {
  const html = renderToStaticMarkup(<CoworkerDataAccess agentId="AGT-EXT-CODEX" current={["public"]} allowed={[]} />);
  expect(html).toContain("Data access: public");
  expect(html).not.toContain("<form");
  expect(html).toContain("An administrator can change");
});
it("saves an explicit selection and uses the returned clearance for the next edit", async () => {
  save.mockResolvedValue({ ok: true, data: { levels: ["public", "internal"] } });
  render(<CoworkerDataAccess agentId="AGT-EXT-CODEX" current={["public"]} allowed={["public", "internal"]} />);
  fireEvent.click(screen.getByLabelText("internal"));
  fireEvent.change(screen.getByLabelText(/Reason for the change/), { target: { value: "Approved internal coding work" } });
  fireEvent.submit(screen.getByText("Save data access").closest("form")!);
  await waitFor(() => expect(save).toHaveBeenCalledWith({ agentId: "AGT-EXT-CODEX", expected: ["public"], levels: ["public", "internal"], reason: "Approved internal coding work" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("without signing in again"));
  save.mockResolvedValue({ ok: false, error: "Data access changed. Refresh and review it again." });
  fireEvent.click(screen.getByLabelText("internal"));
  fireEvent.change(screen.getByLabelText(/Reason for the change/), { target: { value: "Revoke internal coding access" } });
  fireEvent.submit(screen.getByText("Save data access").closest("form")!);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("changed"));
  expect(save.mock.calls[1][0].expected).toEqual(["public", "internal"]);
  expect(screen.getByText("Data access: public, internal")).toBeTruthy();
});
it("keeps editing on demand and resets unsaved choices when the selected coworker changes", () => {
  render(<CoworkerDataAccessSettings allowed={["public", "internal"]} coworkers={[
    { agentId: "codex", name: "Codex", levels: ["public"], editable: true },
    { agentId: "claude", name: "Claude", levels: ["public"], editable: true },
  ]} />);
  expect(screen.queryByLabelText("Coworker")).toBeNull();
  fireEvent.click(screen.getByText("Data access"));
  fireEvent.click(screen.getByLabelText("internal"));
  fireEvent.change(screen.getByLabelText("Coworker"), { target: { value: "claude" } });
  expect((screen.getByLabelText("internal") as HTMLInputElement).checked).toBe(false);
});
it("explains the shared scope and keeps out-of-scope levels disabled", () => {
  const html = renderToStaticMarkup(<CoworkerDataAccess agentId="AGT-EXT-CODEX" current={["public"]} allowed={["public", "internal"]} />);
  expect(html).toContain("Applies to this coworker across connections");
  expect(html).toContain("Each user still needs permission and workroom access");
  expect(html.match(/Outside your access/g)).toHaveLength(2);
  expect(html).toContain("Save data access");
  expect(html).toContain('minLength="10"');
});
