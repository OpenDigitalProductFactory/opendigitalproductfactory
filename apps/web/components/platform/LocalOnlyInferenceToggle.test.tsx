// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/build-studio", () => ({ setLocalOnlyInferenceSetting: save }));
import { LocalOnlyInferenceToggle } from "./LocalOnlyInferenceToggle";

function render(node: ReactNode) {
  return renderView(node, { wrapper: ({ children }) => <MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}>{children}</MessagesProvider> });
}

beforeEach(() => { save.mockReset(); });
afterEach(cleanup);

describe("AI location policy control", () => {
  it("explains the coding consequence and current saved choice", () => {
    render(<LocalOnlyInferenceToggle initialEnabled={false} canWrite />);
    expect(screen.getByRole("group", { name: "Where AI may run" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Local and allowed cloud providers" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/not required for coding/)).toBeTruthy();
  });

  it("keeps the saved choice while pending, then uses the server result", async () => {
    let finish!: (result: { ok: true; enabled: boolean }) => void;
    save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<LocalOnlyInferenceToggle initialEnabled={false} canWrite />);
    fireEvent.click(screen.getByRole("radio", { name: "Local only" }));
    expect(save).toHaveBeenCalledWith(true);
    expect((screen.getByRole("radio", { name: "Local and allowed cloud providers" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Local only" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Saving");
    await act(async () => finish({ ok: true, enabled: true }));
    await waitFor(() => expect((screen.getByRole("radio", { name: "Local only" }) as HTMLInputElement).checked).toBe(true));
  });

  it("keeps local-only selected on a failed relaxation and permits retry", async () => {
    save.mockRejectedValueOnce(new Error("not authorized"));
    render(<LocalOnlyInferenceToggle initialEnabled canWrite />);
    fireEvent.click(screen.getByRole("radio", { name: "Local and allowed cloud providers" }));
    expect((await screen.findByRole("alert")).textContent).toContain("last confirmed setting");
    expect((screen.getByRole("radio", { name: "Local only" }) as HTMLInputElement).checked).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, false);
    const retry = screen.getByRole("radio", { name: "Local and allowed cloud providers" }) as HTMLInputElement;
    await waitFor(() => expect(retry.disabled).toBe(false));
    expect((screen.getByRole("radio", { name: "Local only" }) as HTMLInputElement).checked).toBe(true);
    save.mockResolvedValueOnce({ ok: true, enabled: false });
    fireEvent.click(retry);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, false);
    await waitFor(() => expect((screen.getByRole("radio", { name: "Local and allowed cloud providers" }) as HTMLInputElement).checked).toBe(true));
  });

  it("does not allow changes without provider management permission", () => {
    render(<LocalOnlyInferenceToggle initialEnabled canWrite={false} />);
    for (const input of screen.getAllByRole("radio")) expect((input as HTMLInputElement).disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
