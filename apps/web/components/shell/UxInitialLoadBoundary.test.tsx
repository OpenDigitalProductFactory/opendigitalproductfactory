// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { UxInitialLoadBoundary } from "./UxInitialLoadBoundary";

describe("UxInitialLoadBoundary", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps server markup pending until the route tree hydrates", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <UxInitialLoadBoundary>
        <p>Route content</p>
      </UxInitialLoadBoundary>,
    );
    document.body.append(container);

    expect(container.querySelector('[data-dpf-ux-settle="pending"]')).not.toBeNull();

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(
        container,
        <UxInitialLoadBoundary>
          <p>Route content</p>
        </UxInitialLoadBoundary>,
      );
    });

    expect(container.querySelector("[data-dpf-ux-settle]")).toBeNull();

    await act(async () => {
      root?.unmount();
    });
  });
});
