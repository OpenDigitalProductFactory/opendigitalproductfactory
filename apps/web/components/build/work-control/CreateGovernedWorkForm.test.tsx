// @vitest-environment jsdom
import "@/test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateGovernedWorkForm } from "./CreateGovernedWorkForm";

describe("CreateGovernedWorkForm", () => {
  it("renders title, objective, and taxonomy fields", () => {
    render(<CreateGovernedWorkForm action={vi.fn()} />);

    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/objective/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/taxonomy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plan governed work/i })).toBeInTheDocument();
  });

  it("renders the AGENTS.md taxonomy options", () => {
    render(<CreateGovernedWorkForm action={vi.fn()} />);
    const select = screen.getByLabelText(/taxonomy/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);

    expect(values).toEqual(["feat", "fix", "chore", "doc", "clean"]);
  });
});
