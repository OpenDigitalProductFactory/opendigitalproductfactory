// @vitest-environment jsdom
import "./test-setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactTabs } from "./ArtifactTabs";

describe("ArtifactTabs", () => {
  it("renders all four tab labels", () => {
    render(<ArtifactTabs value="preview" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /preview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /walkthrough/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /what changed/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /the change/i })).toBeInTheDocument();
  });

  it("invokes onChange with the right view id when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<ArtifactTabs value="preview" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /walkthrough/i }));
    expect(onChange).toHaveBeenCalledWith("verification");
  });

  it("marks the selected tab with aria-pressed true", () => {
    render(<ArtifactTabs value="schema" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /what changed/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /preview/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
