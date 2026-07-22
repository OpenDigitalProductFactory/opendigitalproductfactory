// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SectionsManager } from "./SectionsManager";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sections = [
  { id: "sec_1", type: "opening_hours", title: null, sortOrder: 0, isVisible: true },
  { id: "sec_2", type: "menu", title: "Dinner Menu", sortOrder: 1, isVisible: true },
];

function mockFetch(ok: boolean) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => (ok ? { success: true } : { error: "Server said no" }),
  });
}

describe("SectionsManager owner action feedback", () => {
  it("shows an owner-readable name instead of the internal type slug", () => {
    render(<SectionsManager storefrontId="sf_1" sections={sections} />);
    // Humanized fallback for a null title, never the raw "opening_hours" slug.
    expect(screen.getByText("Opening Hours")).toBeTruthy();
    expect(screen.queryByText("opening_hours")).toBeNull();
  });

  it("labels the visibility control per-row and confirms success after saving", async () => {
    vi.stubGlobal("fetch", mockFetch(true));
    render(<SectionsManager storefrontId="sf_1" sections={sections} />);

    const hide = screen.getByRole("button", { name: /hide dinner menu section from your public page/i });
    fireEvent.click(hide);

    // Result is announced to assistive tech and the owner in plain language.
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/hidden from your public page/i));
    // Control flipped to "Show" only after the server confirmed.
    expect(screen.getByRole("button", { name: /show dinner menu section on your public page/i })).toBeTruthy();
  });

  it("keeps the old state and offers Retry when a visibility change fails", async () => {
    vi.stubGlobal("fetch", mockFetch(false));
    render(<SectionsManager storefrontId="sf_1" sections={sections} />);

    fireEvent.click(screen.getByRole("button", { name: /hide dinner menu section from your public page/i }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/server said no|couldn't update/i));
    // Failed save must not leave the UI claiming the change stuck.
    expect(screen.getByRole("button", { name: /hide dinner menu section from your public page/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
