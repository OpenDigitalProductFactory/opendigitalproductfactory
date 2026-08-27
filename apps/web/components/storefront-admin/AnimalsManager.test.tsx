// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The photo gallery is exercised by its own tests and fetches on mount; stub it
// so the fetch assertions below observe only the animal record calls.
vi.mock("./MediaUploader", () => ({
  MediaUploader: () => null,
}));

import { AnimalsManager } from "./AnimalsManager";

// Scout was recorded at intake with the finder's name, telephone number and
// home address in the description, and the description reached the open web
// (BI-56BB6038). Until this fix the only way to take it back was to delete the
// animal and its photographs.
const SCOUT = {
  id: "animal-1",
  name: "Scout",
  species: "dog",
  breed: "Collie cross",
  age: "young",
  sex: "male",
  size: "medium",
  description: "Found by Erin Vasquez, 07700 900123, 14 Mill Lane.",
  status: "hold",
  media: [],
};

function renderManager() {
  return render(<AnimalsManager animals={[SCOUT]} hasAnimalsSection />);
}

/** The details disclosure, opened. */
function openDetails() {
  fireEvent.click(screen.getByText("Details"));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("correcting an animal after intake", () => {
  it("offers every descriptive field for correction, not just name and status", () => {
    renderManager();
    openDetails();

    const details = screen.getByText("Details").closest("details") as HTMLElement;
    expect(within(details).getByDisplayValue("Collie cross")).toBeInTheDocument();
    expect(within(details).getByDisplayValue("young")).toBeInTheDocument();
    expect(within(details).getByDisplayValue("male")).toBeInTheDocument();
    expect(within(details).getByDisplayValue("medium")).toBeInTheDocument();
    expect(within(details).getByDisplayValue(SCOUT.description)).toBeInTheDocument();
  });

  it("stores a redacted description without deleting the animal", async () => {
    renderManager();
    openDetails();

    const field = screen.getByDisplayValue(SCOUT.description);
    fireEvent.change(field, { target: { value: "Found as a stray on Route 9." } });
    fireEvent.blur(field);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/storefront/admin/animals/animal-1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ description: "Found as a stray on Route 9." });
    // The animal and its photographs survive the redaction.
    expect(screen.getByDisplayValue("Scout")).toBeInTheDocument();
  });

  it("does not write to the server on every keystroke", () => {
    renderManager();
    openDetails();

    const field = screen.getByDisplayValue("Collie cross");
    fireEvent.change(field, { target: { value: "Collie" } });
    fireEvent.change(field, { target: { value: "Collie x" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so and rolls the field back when the save is refused", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    renderManager();
    openDetails();

    const field = screen.getByDisplayValue("Collie cross");
    fireEvent.change(field, { target: { value: "Border collie" } });
    fireEvent.blur(field);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Not saved"));
    expect(screen.getByDisplayValue("Collie cross")).toBeInTheDocument();
  });
});

describe("deleting an animal", () => {
  it("asks before destroying the animal and its photographs", () => {
    renderManager();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Also removes the photos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  it("keeps the animal when the confirmation is declined", () => {
    renderManager();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Scout")).toBeInTheDocument();
  });

  it("deletes only on the second, deliberate press", async () => {
    renderManager();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    await waitFor(() => expect(screen.queryByDisplayValue("Scout")).not.toBeInTheDocument());
  });

  it("gives both destructive controls a 44px touch target for the tablet", () => {
    renderManager();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    for (const name of ["Delete", "Keep"]) {
      expect(screen.getByRole("button", { name }).style.minHeight).toBe("44px");
    }
  });
});
