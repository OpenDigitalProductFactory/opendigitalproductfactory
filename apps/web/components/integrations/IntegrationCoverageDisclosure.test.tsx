// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationCoverageDisclosure } from "./IntegrationCoverageDisclosure";

afterEach(cleanup);

describe("IntegrationCoverageDisclosure", () => {
  it("defers the coverage matrix until the operator opens it", () => {
    render(
      <IntegrationCoverageDisclosure>
        <p>Deferred employee coverage</p>
      </IntegrationCoverageDisclosure>,
    );

    const trigger = screen.getByRole("button", { name: "Employee coverage" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Deferred employee coverage")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region").textContent).toContain("Deferred employee coverage");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Deferred employee coverage")).toBeNull();
  });
});
