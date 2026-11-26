// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./SearchableSelect";

const options = [
  { value: "America/Chicago", label: "(UTC-06:00) America/Chicago" },
  { value: "Europe/London", label: "(UTC+00:00) Europe/London" },
  { value: "Asia/Tokyo", label: "(UTC+09:00) Asia/Tokyo" },
];

afterEach(cleanup);

describe("SearchableSelect", () => {
  function renderPicker() {
    const onValueChange = vi.fn();
    render(
      <form aria-label="Settings">
        <SearchableSelect
          ariaLabel="Timezone"
          name="timezone"
          value="America/Chicago"
          onValueChange={onValueChange}
          options={[...options, { value: "disabled", label: "Disabled timezone", disabled: true }]}
        />
        <button type="button">Next field</button>
      </form>,
    );
    const trigger = screen.getByLabelText("Timezone");
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    return { trigger, onValueChange, search: screen.getByLabelText("Search choices", { selector: "input" }) };
  }

  it("puts the active option on the focused search control without moving selection", () => {
    const { search, trigger, onValueChange } = renderPicker();
    expect(search).toHaveFocus();
    expect(trigger).toHaveAccessibleDescription("(UTC-06:00) America/Chicago");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const chicago = screen.getByRole("option", { name: /Chicago/ });
    const london = screen.getByRole("option", { name: /London/ });
    expect(search).toHaveAttribute("aria-activedescendant", chicago.id);
    expect(search).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute("aria-activedescendant", london.id);
    expect(chicago).toHaveAttribute("aria-selected", "true");
    expect(london).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("option", { name: "Disabled timezone" })).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("timezone")).toBe("America/Chicago");
  });

  it("announces no matches without exposing an empty listbox", () => {
    const { search, trigger, onValueChange } = renderPicker();
    fireEvent.change(search, { target: { value: "no such timezone" } });
    expect(search).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(search).not.toHaveAttribute("aria-controls");
    expect(search).not.toHaveAttribute("aria-activedescendant");
    expect(search).toHaveAttribute("aria-expanded", "false");
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(search, { target: { value: "london" } });
    expect(search).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(search).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it.each(["Escape", "Enter"])("returns focus to the trigger after %s", (key) => {
    const { search, trigger, onValueChange } = renderPicker();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    if (key === "Enter") expect(onValueChange).toHaveBeenCalledWith("Europe/London");
    else expect(onValueChange).not.toHaveBeenCalled();
  });

  it("lets Tab move on and closes without pulling focus back", () => {
    const { search, onValueChange } = renderPicker();
    expect(fireEvent.keyDown(search, { key: "Tab" })).toBe(true);
    const next = screen.getByRole("button", { name: "Next field" });
    act(() => next.focus());
    expect(next).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("keeps the option corpus out of the closed page", () => {
    const { container } = render(
      <>
        <label htmlFor="timezone">Timezone</label>
        <SearchableSelect
          id="timezone"
          name="timezone"
          value="America/Chicago"
          onValueChange={vi.fn()}
          options={options}
        />
      </>,
    );

    expect(screen.getByRole("button", { name: "Timezone" })).toHaveTextContent("(UTC-06:00) America/Chicago");
    expect(screen.queryByRole("option", { name: /Europe\/London/ })).not.toBeInTheDocument();
    expect(container.querySelectorAll("option")).toHaveLength(0);
  });

  it("opens a bounded searchable list and returns the selected value", () => {
    const onValueChange = vi.fn();
    render(
      <SearchableSelect
        ariaLabel="Timezone"
        value="America/Chicago"
        onValueChange={onValueChange}
        options={options}
        maxVisibleOptions={2}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Timezone" }));

    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.change(screen.getByRole("combobox", { name: "Search choices" }), {
      target: { value: "tokyo" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Asia\/Tokyo/ }));

    expect(onValueChange).toHaveBeenCalledWith("Asia/Tokyo");
  });
});
