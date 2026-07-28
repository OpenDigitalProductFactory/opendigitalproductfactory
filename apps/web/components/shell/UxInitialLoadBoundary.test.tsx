// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UxInitialLoadBoundary } from "./UxInitialLoadBoundary";

describe("UxInitialLoadBoundary", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps server markup pending until the route tree hydrates", async () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<div data-dpf-ux-settle="pending"><p>Route content</p></div>';
    document.body.append(container);

    expect(container.querySelector('[data-dpf-ux-settle="pending"]')).not.toBeNull();

    const result = render(
      <UxInitialLoadBoundary>
        <p>Route content</p>
      </UxInitialLoadBoundary>,
      {
        container,
        hydrate: true,
      },
    );

    await waitFor(() => {
      expect(container.querySelector("[data-dpf-ux-settle]")).toBeNull();
    });

    result.unmount();
  });
});
