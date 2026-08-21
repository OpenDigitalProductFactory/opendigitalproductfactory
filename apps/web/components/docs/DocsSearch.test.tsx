// @vitest-environment jsdom
import "@/test-setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocsSearch } from "./DocsSearch";

describe("DocsSearch", () => {
  it("searches authored descriptions and shows the result summary", () => {
    render(
      <DocsSearch
        items={[
          {
            slug: "storefront/setup-and-launch",
            title: "Setup And Launch",
            area: "storefront",
            description: "Create, readiness-check, publish, and verify the public portal.",
            content: "URL slug sections items",
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search docs..."), {
      target: { value: "readiness" },
    });

    expect(screen.getByText("Setup And Launch")).toBeInTheDocument();
    expect(
      screen.getByText("Create, readiness-check, publish, and verify the public portal."),
    ).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Documentation search results" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Setup And Launch/ })).toBeInTheDocument();
  });

  it("exposes an accessible combobox and closes its results with Escape", () => {
    render(
      <DocsSearch
        items={[
          {
            slug: "storefront/setup-and-launch",
            title: "Setup And Launch",
            area: "storefront",
            description: "Publish the public portal.",
            content: "readiness verification",
          },
        ]}
      />,
    );

    const search = screen.getByRole("combobox", { name: "Search documentation" });
    expect(search).toHaveAttribute("aria-expanded", "false");

    fireEvent.change(search, { target: { value: "publish" } });
    expect(search).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveAttribute("aria-expanded", "false");
  });
});
