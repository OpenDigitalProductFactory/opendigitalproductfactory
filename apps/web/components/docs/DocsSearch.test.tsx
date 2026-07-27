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
  });
});
