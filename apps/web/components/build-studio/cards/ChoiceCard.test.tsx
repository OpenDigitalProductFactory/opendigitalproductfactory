// @vitest-environment jsdom
import "../test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChoiceCard } from "./ChoiceCard";

const choice = {
  id: "grace",
  label: "Grace window for the old key",
  picked: "60 seconds",
  options: ["No grace — instant cut-off", "60 seconds", "5 minutes", "Custom…"],
};

describe("ChoiceCard", () => {
  it("renders the label and all options", () => {
    render(<ChoiceCard choice={choice} />);
    expect(screen.getByText(choice.label)).toBeInTheDocument();
    for (const o of choice.options) expect(screen.getByText(o)).toBeInTheDocument();
  });

  it("highlights the picked option with aria-pressed=true", () => {
    render(<ChoiceCard choice={choice} />);
    expect(screen.getByRole("button", { name: "60 seconds" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "5 minutes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("changes selection on click", () => {
    render(<ChoiceCard choice={choice} />);
    fireEvent.click(screen.getByRole("button", { name: "5 minutes" }));
    expect(screen.getByRole("button", { name: "5 minutes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "60 seconds" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
