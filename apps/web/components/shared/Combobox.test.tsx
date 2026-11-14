// @vitest-environment jsdom

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Combobox, ComboboxListbox, useCombobox, type ComboboxOption } from "./Combobox";

// BI-2F7BE778 §3.5: the shared WAI-ARIA APG combobox. The wiki editor drives it
// from a textarea; the quick switcher (BI-359C7C2F) will drive it from an input.

afterEach(cleanup);

const OPTIONS: ComboboxOption[] = [
  { id: "a", label: "Alpha", description: "entities/alpha", badge: "Platform" },
  { id: "b", label: "Beta", description: "entities/beta" },
  { id: "c", label: "Gamma", description: "entities/gamma" },
];

function InputHarness({ onSelect, options = OPTIONS, loading = false }: { onSelect: (o: ComboboxOption) => void; options?: ComboboxOption[]; loading?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <Combobox
      label="Find a page"
      value={value}
      onValueChange={setValue}
      options={options}
      onSelect={onSelect}
      loading={loading}
      loadingMessage="Searching"
      emptyMessage="No match"
      selectOnTab
    />
  );
}

function TextareaHarness({ onSelect }: { onSelect: (o: ComboboxOption) => void }) {
  const [open, setOpen] = useState(true);
  const combobox = useCombobox({ options: OPTIONS, open, onOpenChange: setOpen, onSelect });
  return (
    <div>
      <textarea aria-label="Body" {...combobox.controlProps} onKeyDown={(e) => combobox.handleKeyDown(e)} />
      <ComboboxListbox combobox={combobox} options={OPTIONS} label="Pages" emptyMessage="No match" />
    </div>
  );
}

function typeInto(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
}

describe("Combobox (input-driven)", () => {
  it("wires the APG combobox roles and states", () => {
    render(<InputHarness onSelect={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Find a page" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(screen.queryByRole("option")).toBeNull();

    typeInto(input, "al");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("moves with the arrow keys, wrapping at both ends", () => {
    render(<InputHarness onSelect={vi.fn()} />);
    const input = screen.getByRole("combobox");
    typeInto(input, "a");
    const ids = screen.getAllByRole("option").map((o) => o.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(ids[1]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(ids[0]);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(ids[2]);
  });

  it("selects the active option on Enter and on Tab when enabled", () => {
    const onSelect = vi.fn();
    render(<InputHarness onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    typeInto(input, "a");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(OPTIONS[1]);
    expect(input.getAttribute("aria-expanded")).toBe("false");

    typeInto(input, "g");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onSelect).toHaveBeenLastCalledWith(OPTIONS[0]);
  });

  it("closes on Escape and Alt+ArrowUp, and opens again on Alt+ArrowDown", () => {
    render(<InputHarness onSelect={vi.fn()} />);
    const input = screen.getByRole("combobox");
    typeInto(input, "a");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp", altKey: true });
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("selects with the mouse without taking focus from the control", () => {
    const onSelect = vi.fn();
    render(<InputHarness onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    typeInto(input, "a");
    const third = screen.getAllByRole("option")[2]!;
    const down = fireEvent.mouseDown(third);
    expect(down).toBe(false); // default prevented, so focus stays in the control
    fireEvent.click(third);
    expect(onSelect).toHaveBeenCalledWith(OPTIONS[2]);
  });

  it("announces loading and an empty result", () => {
    const { rerender } = render(<InputHarness onSelect={vi.fn()} options={[]} loading />);
    const input = screen.getByRole("combobox");
    typeInto(input, "zz");
    expect(screen.getByRole("status").textContent).toBe("Searching");
    rerender(<InputHarness onSelect={vi.fn()} options={[]} />);
    expect(screen.getByRole("status").textContent).toBe("No match");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("styles through theme tokens only", () => {
    render(<InputHarness onSelect={vi.fn()} />);
    typeInto(screen.getByRole("combobox"), "a");
    const html = document.body.innerHTML;
    expect(html).toContain("var(--dpf-surface-");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|text-white|bg-white|gray-\d/);
  });
});

describe("Combobox driven by another control (textarea)", () => {
  it("lets the textarea own the keys while the listbox is open", () => {
    const onSelect = vi.fn();
    render(<TextareaHarness onSelect={onSelect} />);
    const textarea = screen.getByRole("combobox", { name: "Body" });
    expect(textarea.tagName).toBe("TEXTAREA");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(OPTIONS[2]);
  });

  it("leaves Enter alone when the listbox is closed, so the textarea gets a new line", () => {
    const onSelect = vi.fn();
    render(<TextareaHarness onSelect={onSelect} />);
    const textarea = screen.getByRole("combobox");
    fireEvent.keyDown(textarea, { key: "Escape" });
    const enter = fireEvent.keyDown(textarea, { key: "Enter" });
    expect(enter).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
