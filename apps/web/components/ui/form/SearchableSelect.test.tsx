// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./SearchableSelect";

const options = [
  { value: "America/Chicago", label: "(UTC-06:00) America/Chicago" },
  { value: "Europe/London", label: "(UTC+00:00) Europe/London" },
  { value: "Asia/Tokyo", label: "(UTC+09:00) Asia/Tokyo" },
];

afterEach(cleanup);

describe("SearchableSelect", () => {
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

    expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveValue("(UTC-06:00) America/Chicago");
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

    fireEvent.click(screen.getByRole("combobox", { name: "Timezone" }));

    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox", { name: "Search choices" }), {
      target: { value: "tokyo" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Asia\/Tokyo/ }));

    expect(onValueChange).toHaveBeenCalledWith("Asia/Tokyo");
  });
});
