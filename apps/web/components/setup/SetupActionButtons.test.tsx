// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SetupActionButtons } from "./SetupActionButtons";

afterEach(cleanup);

describe("SetupActionButtons", () => {
  it("explains safe defer and gives every action an unambiguous accessible name", () => {
    render(<SetupActionButtons />);

    expect(screen.getByText(/Skipping does not approve a provider/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue setup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip this step safely" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause and review later" })).toBeTruthy();
  });

  it("dispatches safe skip and review-later actions from native buttons", () => {
    const actions: string[] = [];
    const handler = (event: Event) => actions.push((event as CustomEvent<string>).detail);
    document.addEventListener("setup-action", handler);
    render(<SetupActionButtons />);

    fireEvent.click(screen.getByRole("button", { name: "Skip this step safely" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause and review later" }));

    document.removeEventListener("setup-action", handler);
    expect(actions).toEqual(["skip", "pause"]);
  });
});
