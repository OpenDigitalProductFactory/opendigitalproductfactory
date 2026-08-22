// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProductMixSetupFieldset,
  defaultProductLineSelections,
} from "./ProductMixSetupFieldset";

const mix = {
  primary: {
    key: "salon-services",
    label: "Salon services",
    products: [{ key: "haircuts", label: "Haircuts" }],
  },
  adjacent: [
    {
      key: "retail-goods",
      label: "Hair-care products",
      products: [{ key: "hair-care", label: "Hair care" }],
    },
  ],
};

describe("ProductMixSetupFieldset", () => {
  afterEach(cleanup);

  it("shows one required primary line and optional adjacent suggestions", () => {
    render(
      <ProductMixSetupFieldset
        archetypeCategory="beauty-personal-care"
        productMix={mix}
        value={defaultProductLineSelections(mix)}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("group", { name: "What does your business sell?" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Salon services")).toBeRequired();
    expect(
      screen.getByRole("checkbox", { name: /Hair-care products/ }),
    ).not.toBeChecked();
    expect(screen.queryByText(/provider|consumer|portfolio slug/i)).not.toBeInTheDocument();
  });

  it("selects adjacent lines, renames the primary, and adds/removes custom lines", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ProductMixSetupFieldset
        archetypeCategory="beauty-personal-care"
        productMix={mix}
        value={defaultProductLineSelections(mix)}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("Salon services"), {
      target: { value: "Hair services" },
    });
    expect(onChange).toHaveBeenLastCalledWith([
      { suggestionKey: "salon-services", label: "Hair services" },
    ]);

    fireEvent.click(screen.getByRole("checkbox", { name: /Hair-care products/ }));
    expect(onChange).toHaveBeenLastCalledWith([
      { suggestionKey: "salon-services", label: "Salon services" },
      { suggestionKey: "retail-goods", label: "Hair-care products" },
    ]);

    rerender(
      <ProductMixSetupFieldset
        archetypeCategory="beauty-personal-care"
        productMix={mix}
        value={[
          { suggestionKey: "salon-services", label: "Salon services" },
          { suggestionKey: null, label: "Training" },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("Training")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Training" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { suggestionKey: "salon-services", label: "Salon services" },
    ]);
  });

  it("uses programme and supporter language for nonprofit setup", () => {
    render(
      <ProductMixSetupFieldset
        archetypeCategory="nonprofit-community"
        productMix={mix}
        value={defaultProductLineSelections(mix)}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("group", { name: "What does your organization offer?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Main programme")).toBeInTheDocument();
    expect(screen.getByText(/supporters or the people you serve/i)).toBeInTheDocument();
    expect(screen.queryByText(/customers buy|main product line/i)).toBeNull();
  });
});
