// @vitest-environment jsdom
import "./test-setup";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SearchableSelect } from "./SearchableSelect";

const OPTIONS = [
  { value: "HR-000", label: "HR-000 - CDIO" },
  { value: "HR-100", label: "HR-100 - Portfolio Manager" },
  { value: "HR-200", label: "HR-200 - Product Manager" },
];

describe("SearchableSelect", () => {
  it("offers every option to the datalist without asking the reader to scan a flat select", () => {
    render(
      <SearchableSelect label="User Role" options={OPTIONS} value="HR-000" onChange={() => {}} />,
    );

    // The whole point of this control: no <select>, so lib/ux-budget's
    // `maxChoicesPerControl` (which only counts <option> inside <select>) sees
    // zero pushed-down choices — while every option is still reachable.
    expect(document.querySelector("select")).toBeNull();
    expect(document.querySelectorAll("datalist option")).toHaveLength(3);
    expect(screen.getByRole("combobox")).toHaveValue("HR-000 - CDIO");
    expect(screen.getByRole("status")).toHaveTextContent("3 available");
  });

  it("commits the selection when typed text resolves to an option label", () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect label="User Role" options={OPTIONS} value="HR-000" onChange={onChange} />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "HR-200 - Product Manager" },
    });

    expect(onChange).toHaveBeenCalledWith("HR-200");
  });

  it("also resolves a pasted raw option value", () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect label="User Role" options={OPTIONS} value="HR-000" onChange={onChange} />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "HR-100" } });

    expect(onChange).toHaveBeenCalledWith("HR-100");
  });

  it("never commits an unresolved value, and says so instead of selecting nothing", () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect label="User Role" options={OPTIONS} value="HR-000" onChange={onChange} />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "not a role" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("No match");
  });

  it("restores the committed selection when the reader leaves half-typed text behind", () => {
    render(
      <SearchableSelect label="User Role" options={OPTIONS} value="HR-100" onChange={() => {}} />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "HR-1" } });
    fireEvent.blur(input);

    expect(input).toHaveValue("HR-100 - Portfolio Manager");
  });

  it("reports an empty option set rather than rendering a dead control", () => {
    render(
      <SearchableSelect
        label="Route Context"
        options={[]}
        value=""
        onChange={() => {}}
        emptyLabel="No route binding"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("No route binding");
  });
});
