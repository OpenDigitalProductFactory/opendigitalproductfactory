// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MediaUploader } from "./MediaUploader";

// The rescue's photographs are managed on the 768x1024 tablet a kennel
// technician holds one-handed. The remove control measured 24x24 and deleted a
// photograph on a single unconfirmed press (BI-56BB6038 / BI-6395DA89).
const PHOTO = {
  attachmentId: "att-1",
  assetId: "asset-1",
  url: "/media/ranger-1.jpg",
  altText: "Ranger, a tan dog, sitting",
  caption: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === "GET") {
      return { ok: true, json: async () => ({ media: [PHOTO] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderGallery() {
  render(<MediaUploader ownerType="AdoptableAnimal" ownerId="animal-1" role="gallery" label="Photos" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument());
}

describe("removing a photograph", () => {
  it("asks before destroying it", async () => {
    await renderGallery();
    const deletes = () =>
      fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === "DELETE");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(deletes()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Remove this photo for good" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep this photo" })).toBeInTheDocument();
  });

  it("keeps the photograph when the confirmation is declined", async () => {
    await renderGallery();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep this photo" }));

    expect(
      fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === "DELETE"),
    ).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("deletes only on the second, deliberate press", async () => {
    await renderGallery();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove this photo for good" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === "DELETE"),
      ).toHaveLength(1),
    );
  });

  it("gives every destructive control a 44px target for the tablet", async () => {
    await renderGallery();

    expect(screen.getByRole("button", { name: "Remove" }).style.minHeight).toBe("44px");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    for (const name of ["Remove this photo for good", "Keep this photo"]) {
      const button = screen.getByRole("button", { name });
      expect(button.style.minHeight, `${name} height`).toBe("44px");
      expect(button.style.minWidth, `${name} width`).toBe("44px");
    }
  });
});
